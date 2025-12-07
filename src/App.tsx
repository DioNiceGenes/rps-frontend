import { useState, useEffect } from 'react';
import './index.css';
import { ethers } from 'ethers';

const CONTRACT = '0xD8d4da2972BD265506F3e2cd14A5458EB2cc092A';

const ABI = [
  "function createGame() payable returns (uint256)",
  "function joinGame(uint256) payable",
  "function commitMove(uint256 gameId, bytes32 commitHash)",
  "function revealMove(uint256 gameId, uint8 move, string salt)",
  "function getOpenGames() view returns (uint256[])",
  "function getGameInfo(uint256) view returns (address player1, address player2, uint256 betAmount, uint8 status, uint256 blocksLeft, uint8 move1, uint8 move2)",
  "function gameCounter() view returns (uint256)"
];

type Game = {
  id: number;
  player1: string;
  player2: string | null;
  bet: string;
  status: 'Open' | 'Committed' | 'Revealed' | 'Finished';
  blocksLeft: number;
  move1: number;
  move2: number;
  isPlayer1: boolean;
};

export default function App() {
  const [account, setAccount] = useState('');
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [bet, setBet] = useState('0.001');
  const [openGames, setOpenGames] = useState<Game[]>([]);
  const [myGames, setMyGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMove, setSelectedMove] = useState<{ [id: number]: 1 | 2 | 3 }>({});

  const moveName = (m: number) => m === 1 ? 'Камень' : m === 2 ? 'Бумага' : m === 3 ? 'Ножницы' : '—';
  const moveEmoji = (m: number) => m === 1 ? 'Rock' : m === 2 ? 'Paper' : m === 3 ? 'Scissors' : '';

  const connect = async () => {
    if (!window.ethereum) return alert('Установи MetaMask!');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const prov = new ethers.BrowserProvider(window.ethereum);
    const network = await prov.getNetwork();
    if (network.chainId !== 97n) return alert('Переключись на BNB Testnet (chainId 97)');
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
      const ids: bigint[] = await contract.getOpenGames().catch(() => []);
      const games = await Promise.all(ids.map(async (idBig: bigint) => {
        const id = Number(idBig);
        const [p1, p2, betAmt, statusNum, blocksLeft, m1, m2] = await contract.getGameInfo(id);
        return {
          id,
          player1: p1,
          player2: p2 === ethers.ZeroAddress ? null : p2,
          bet: ethers.formatEther(betAmt),
          status: ['Open','Committed','Revealed','Finished'][Number(statusNum)] as any,
          blocksLeft: Number(blocksLeft),
          move1: Number(m1),
          move2: Number(m2),
          isPlayer1: p1.toLowerCase() === account.toLowerCase()
        };
      }));
      setOpenGames(games.filter(g => g.status === 'Open'));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadMyGames = async () => {
    if (!contract || !account) return;
    try {
      const counter: bigint = await contract.gameCounter();
      const games: Game[] = [];
      for (let i = 1; i <= Number(counter); i++) {
        try {
          const [p1, p2, betAmt, statusNum, blocksLeft, m1, m2] = await contract.getGameInfo(i);
          const isPlayer1 = p1.toLowerCase() === account.toLowerCase();
          const isPlayer2 = p2 && p2.toLowerCase() === account.toLowerCase();
          if (isPlayer1 || isPlayer2) {
            const status = ['Open','Committed','Revealed','Finished'][Number(statusNum)] as any;
            games.push({
              id: i,
              player1: p1,
              player2: p2 === ethers.ZeroAddress ? null : p2,
              bet: ethers.formatEther(betAmt),
              status,
              blocksLeft: Number(blocksLeft),
              move1: Number(m1),
              move2: Number(m2),
              isPlayer1
            });
          }
        } catch {}
      }
      setMyGames(games);
    } catch (e) { console.error(e); }
  };

  const createGame = async () => {
    if (!contract) return;
    try {
      const tx = await contract.createGame({ value: ethers.parseEther(bet) });
      await tx.wait();
      loadOpenGames(); loadMyGames();
    } catch (err: any) { alert(err?.reason || err.message); }
  };

  const joinGame = async (id: number) => {
    if (!contract) return;
    const game = openGames.find(g => g.id === id);
    if (!game) return;
    try {
      const tx = await contract.joinGame(id, { value: ethers.parseEther(game.bet) });
      await tx.wait();
      loadOpenGames(); loadMyGames();
    } catch (err: any) { alert(err?.reason || err.message); }
  };

  const commitMove = async (gameId: number) => {
  const move = selectedMove[gameId];
  if (!move || !contract) return alert('Выбери ход!');

  const salt = Math.random().toString(36).substring(2) + Date.now();

  const hash = ethers.keccak256(
    ethers.concat([
      ethers.zeroPadValue(ethers.toBeHex(move), 1), // uint8 как 1 байт
      ethers.toUtf8Bytes(salt)                      // string как bytes
    ])
  );

  try {
    const tx = await contract.commitMove(gameId, hash);
    await tx.wait();
    localStorage.setItem(`move_${gameId}_${account}`, JSON.stringify({ move, salt }));
    alert('Ход закоммичен!');
    setSelectedMove(p => { const x = { ...p }; delete x[gameId]; return x; });
    loadMyGames();
  } catch (err: any) {
    alert(err?.reason || err.message);
  }
};

  const revealMove = async (gameId: number) => {
    if (!contract) return;
    const data = localStorage.getItem(`move_${gameId}_${account}`);
    if (!data) return alert('Твой ход не найден! Сделай commit заново.');
    const { move, salt } = JSON.parse(data);
    try {
      const tx = await contract.revealMove(gameId, move, salt);
      await tx.wait();
      localStorage.removeItem(`move_${gameId}_${account}`);
      alert('Ход раскрыт! Ждём второго игрока...');
      loadMyGames();
    } catch (err: any) { alert(err?.reason || err.message); }
  };

  useEffect(() => {
    if (contract && account) {
      loadOpenGames();
      loadMyGames();
      const i = setInterval(() => { loadOpenGames(); loadMyGames(); }, 10000);
      return () => clearInterval(i);
    }
  }, [contract, account]);

  return (
    <div className="container">
      <h1>Rock Paper Scissors</h1>

      {!account ? (
        <div style={{textAlign:'center', marginTop:'100px'}}>
          <button className="connect-btn" onClick={connect}>Connect MetaMask</button>
        </div>
      ) : (
        <>
          <p style={{textAlign:'center'}}>Подключён: {account.slice(0,6)}...{account.slice(-4)}</p>

          <div className="game-card" style={{textAlign:'center', marginBottom:'40px'}}>
            <h2>Создать игру</h2>
            <input value={bet} onChange={e => setBet(e.target.value)} placeholder="Ставка tBNB" />
            <button className="action-btn green" onClick={createGame}>Создать за {bet} tBNB</button>
          </div>

          <h2>Открытые игры {loading && '(загрузка...)'}</h2>
          {openGames.length === 0 ? (
            <p style={{textAlign:'center', opacity:0.7}}>Нет открытых игр — создай свою!</p>
          ) : (
            <div className="game-list">
              {openGames.map(g => (
                <div key={g.id} className="game-card active">
                  <div>Игра #{g.id} — {g.bet} tBNB</div>
                  <p>Создатель: {g.player1.slice(0,6)}...</p>
                  {g.isPlayer1 ? (
                    <p style={{color:'#0f0'}}>Твоя игра — ждём соперника</p>
                  ) : (
                    <button className="action-btn purple" onClick={() => joinGame(g.id)}>Присоединиться</button>
                  )}
                </div>
              ))}
            </div>
          )}

          <h2 style={{marginTop:'60px'}}>Мои активные игры ({myGames.length})</h2>
          {myGames.length === 0 ? (
            <p style={{textAlign:'center', opacity:0.7}}>Нет активных игр</p>
          ) : (
            <div className="game-list">
              {myGames.map(g => (
                <div key={g.id} className="game-card active">
                  <div><strong>Игра #{g.id}</strong> — {g.bet} tBNB</div>
                  <p>Статус: <strong>{g.status}</strong> | Блоков до таймаута: {g.blocksLeft}</p>

                  {/* COMMIT PHASE */}
                  {g.status === 'Committed' && (
                    <div style={{marginTop:'15px'}}>
                      <h4>Выбери свой ход:</h4>
                      <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                        {[1,2,3].map(m => (
                          <button
                            key={m}
                            className={`action-btn ${selectedMove[g.id] === m ? 'selected' : ''}`}
                            onClick={() => setSelectedMove(p => ({...p, [g.id]: m as any}))}
                          >
                            {moveName(m)} {moveEmoji(m)}
                          </button>
                        ))}
                      </div>
                      {selectedMove[g.id] && (
                        <button className="action-btn orange" onClick={() => commitMove(g.id)} style={{marginTop:'10px'}}>
                          Закоммитить {moveName(selectedMove[g.id])}
                        </button>
                      )}
                    </div>
                  )}

                  {/* REVEAL PHASE */}
                  {(g.status === 'Revealed' || g.status === 'Finished') && (
                    <div style={{marginTop:'15px', padding:'15px', background:'#f0f8ff', borderRadius:'8px'}}>
                      <h4>Раскрытые ходы:</h4>
                      <div style={{display:'flex', justifyContent:'space-around', fontSize:'1.4rem'}}>
                        <div>
                          <strong>Ты</strong><br/>
                          {g.isPlayer1 ? moveName(g.move1) : moveName(g.move2)} {g.isPlayer1 ? moveEmoji(g.move1) : moveEmoji(g.move2)}
                        </div>
                        <div style={{textAlign:'right'}}>
                          <strong>Оппонент</strong><br/>
                          {g.isPlayer1 ? moveName(g.move2) : moveName(g.move1)} {g.isPlayer1 ? moveEmoji(g.move2) : moveEmoji(g.move1)}
                        </div>
                      </div>

                      {g.status === 'Revealed' && g.blocksLeft > 0 && (
                        <button className="action-btn blue" onClick={() => revealMove(g.id)} style={{marginTop:'10px'}}>
                          Раскрыть свой ход ({g.blocksLeft} блоков)
                        </button>
                      )}

                      {g.status === 'Finished' && (
                        <p style={{marginTop:'15px', padding:'10px', background:'#d4edda', borderRadius:'6px', fontWeight:'bold', color:'#155724'}}>
                          Игра завершена! Приз отправлен победителю
                        </p>
                      )}
                    </div>
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