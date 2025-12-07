import { useState, useEffect } from 'react';
import './index.css';
import { ethers } from 'ethers';

const CONTRACT = '0x300F1aE97FD0C48510Fa04075E80D0a121e0199E';
const ABI = [
  "function createGame() payable returns (uint256)",
  "function joinGame(uint256) payable",
  "function getOpenGames() view returns (uint256[])",
  "function getGameInfo(uint256) view returns (address player1, address player2, uint256 betAmount, uint8 status, uint256 blocksLeft)",
  "event NewGame(uint256 indexed gameId, address indexed player1, uint256 bet)",
  "event Joined(uint256 indexed gameId, address indexed player2)"
];

type Game = {
  id: number;
  player1: string;
  bet: string;
  status: string;
  isMyGame: boolean;
};

export default function App() {
  const [account, setAccount] = useState('');
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [bet, setBet] = useState('0.001');
  const [openGames, setOpenGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);

  const connect = async () => {
  if (!window.ethereum) return alert('Установи MetaMask!');

  await window.ethereum.request({ method: 'eth_requestAccounts' });

  const prov = new ethers.BrowserProvider(window.ethereum);
  // Принудительно переключаем на надёжный RPC
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: "0x61", // 97 в hex
      chainName: "BNB Smart Chain Testnet",
      rpcUrls: ["https://bsc-testnet-rpc.publicnode.com"],
      nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
      blockExplorerUrls: ["https://testnet.bscscan.com"]
    }]
  });

  const signer = await prov.getSigner();
  const addr = await signer.getAddress();
  const ctr = new ethers.Contract(CONTRACT, ABI, signer);

  setProvider(prov);
  setContract(ctr);
  setAccount(addr);
};

  const loadOpenGames = async () => {
    if (!contract || !account) return;
    try {
      setLoading(true);
      const ids: bigint[] = await contract.getOpenGames().catch(() => []);      const games = await Promise.all(
        ids.map(async (idBig: bigint) => {
          const id = Number(idBig);
          const [p1, , betAmt, statusNum] = await contract.getGameInfo(id);
          return {
            id,
            player1: p1,
            bet: ethers.formatEther(betAmt),
            status: ['Open','Committed','Revealed','Finished'][Number(statusNum)],
            isMyGame: p1.toLowerCase() === account.toLowerCase()
          };
        })
      );
      setOpenGames(games.filter(g => g.status === 'Open'));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const createGame = async () => {
    if (!contract) return;
    try {
      const tx = await contract.createGame({ value: ethers.parseEther(bet) });
      await tx.wait();
      loadOpenGames();
    } catch (err: any) { alert(err?.reason || err.message); }
  };

  const joinGame = async (gameId: number) => {
    if (!contract) return;
    const game = openGames.find(g => g.id === gameId);
    if (!game) return;
    try {
      const tx = await contract.joinGame(gameId, { value: ethers.parseEther(game.bet) });
      await tx.wait();
      loadOpenGames();
    } catch (err: any) { alert(err?.reason || err.message); }
  };

  useEffect(() => {
    if (contract && account) {
      loadOpenGames();
      const interval = setInterval(loadOpenGames, 9000);
      return () => clearInterval(interval);
    }
  }, [contract, account]);

  return (
    <div className="container">
      <h1>Rock Paper Scissors — Multi Table</h1>

      {!account ? (
        <div style={{textAlign:'center', marginTop: '100px'}}>
          <button className="connect-btn" onClick={connect}>Connect MetaMask</button>
        </div>
      ) : (
        <>
          <p style={{textAlign:'center'}}>Подключён: {account.slice(0,6)}...{account.slice(-4)}</p>

          <div className="game-card" style={{textAlign:'center', marginBottom: '40px'}}>
            <h2>Создать новую игру</h2>
            <input value={bet} onChange={e => setBet(e.target.value)} placeholder="Ставка в BNB" />
            <button className="action-btn green" onClick={createGame}>
              Создать за {bet} BNB
            </button>
          </div>

          <h2>Открытые игры {loading && '(обновляется...)'}</h2>
          {openGames.length === 0 ? (
            <p style={{textAlign:'center', opacity:0.7}}>Нет открытых игр — будь первым!</p>
          ) : (
            <div className="game-list">
              {openGames.map(g => (
                <div key={g.id} className="game-card active">
                  <div>Игра #{g.id} — {g.bet} BNB</div>
                  <p>Создатель: {g.player1.slice(0,6)}...{g.player1.slice(-4)}</p>
                  
                  {g.isMyGame ? (
                    <p style={{color:'#0f0'}}>Это твоя игра — ждём соперника</p>
                  ) : (
                    <button className="action-btn purple" onClick={() => joinGame(g.id)}>
                      Присоединиться
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}