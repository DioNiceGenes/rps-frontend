// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RockPaperScissorsFinal {
    enum Move { None, Rock, Paper, Scissors }
    enum GameStatus { Open, Committed, Revealed, Finished }

    struct Game {
        address player1;
        address player2;
        uint256 betAmount;
        bytes32 commit1;
        bytes32 commit2;
        Move move1;
        Move move2;
        GameStatus status;
        uint256 deadline;
    }

    uint256 public gameCounter;
    mapping(uint256 => Game) public games;
    uint256[] public openGameIds;

    uint256 public constant REVEAL_TIMEOUT = 10000; // ~15 минут

    event NewGame(uint256 indexed gameId, address indexed player1, uint256 bet);
    event Joined(uint256 indexed gameId, address indexed player2);
    event MoveCommitted(uint256 indexed gameId, address indexed player);
    event Revealed(uint256 indexed gameId, address indexed player, Move move);
    event Winner(uint256 indexed gameId, address indexed winner, uint256 amount);

    modifier onlyPlayer(uint256 gameId) {
        require(msg.sender == games[gameId].player1 || msg.sender == games[gameId].player2, "Not player");
        _;
    }

    function createGame() external payable returns (uint256 gameId) {
        require(msg.value > 0, "Bet > 0");
        gameId = ++gameCounter;

        games[gameId] = Game({
            player1: msg.sender,
            player2: address(0),
            betAmount: msg.value,
            commit1: bytes32(0),
            commit2: bytes32(0),
            move1: Move.None,
            move2: Move.None,
            status: GameStatus.Open,
            deadline: 0
        });

        openGameIds.push(gameId);
        emit NewGame(gameId, msg.sender, msg.value);
    }

    function joinGame(uint256 gameId) external payable {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Open, "Not open");
        require(msg.sender != g.player1, "Already player1");
        require(msg.value == g.betAmount, "Wrong bet");

        g.player2 = msg.sender;
        g.status = GameStatus.Committed;
        g.deadline = block.number + REVEAL_TIMEOUT;
        _removeFromOpenGames(gameId);

        emit Joined(gameId, msg.sender);
    }

    function commitMove(uint256 gameId, bytes32 commitHash) external onlyPlayer(gameId) {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Committed, "Not commit phase");

        if (msg.sender == g.player1) g.commit1 = commitHash;
        else g.commit2 = commitHash;

        if (g.commit1 != 0 && g.commit2 != 0) {
            g.status = GameStatus.Revealed;
        }
        emit MoveCommitted(gameId, msg.sender);
    }

    function revealMove(uint256 gameId, Move move, string calldata salt) external onlyPlayer(gameId) {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Revealed, "Not reveal phase");
        require(block.number <= g.deadline, "Timeout");

        bytes32 hash = keccak256(abi.encodePacked(uint8(move), salt));
        if (msg.sender == g.player1) {
            require(hash == g.commit1, "Invalid commit");
            g.move1 = move;
        } else {
            require(hash == g.commit2, "Invalid commit");
            g.move2 = move;
        }

        if (g.move1 != Move.None && g.move2 != Move.None) {
            _payout(gameId);
        }
        emit Revealed(gameId, msg.sender, move);
    }

    function _payout(uint256 gameId) private {
        Game storage g = games[gameId];
        uint256 prize = g.betAmount * 2;

        if (g.move1 == g.move2) {
            payable(g.player1).transfer(g.betAmount);
            payable(g.player2).transfer(g.betAmount);
            emit Winner(gameId, address(0), 0); // ничья
        } else {
            address winner = 
                (g.move1 == Move.Rock && g.move2 == Move.Scissors) ||
                (g.move1 == Move.Scissors && g.move2 == Move.Paper) ||
                (g.move1 == Move.Paper && g.move2 == Move.Rock)
                ? g.player1 : g.player2;

            payable(winner).transfer(prize);
            emit Winner(gameId, winner, prize);
        }
        g.status = GameStatus.Finished;
    }

    function _removeFromOpenGames(uint256 gameId) internal {
        for (uint256 i = 0; i < openGameIds.length; i++) {
            if (openGameIds[i] == gameId) {
                openGameIds[i] = openGameIds[openGameIds.length - 1];
                openGameIds.pop();
                break;
            }
        }
    }

    function getOpenGames() external view returns (uint256[] memory) {
        return openGameIds;
    }

    // Возвращает и ходы!
    function getGameInfo(uint256 gameId) external view returns (
        address player1,
        address player2,
        uint256 betAmount,
        uint8 status,
        uint256 blocksLeft,
        uint8 move1,
        uint8 move2
    ) {
        Game storage g = games[gameId];
        blocksLeft = g.deadline > block.number ? g.deadline - block.number : 0;
        return (
            g.player1,
            g.player2,
            g.betAmount,
            uint8(g.status),
            blocksLeft,
            uint8(g.move1),
            uint8(g.move2)
        );
    }

    function claimTimeout(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Revealed, "Game not in reveal phase");
        require(block.number > g.deadline, "Timeout not reached");
        require(msg.sender == g.player1 || msg.sender == g.player2, "Not a player");

        g.status = GameStatus.Finished;

        // Возвращаем каждому его ставку
        payable(g.player1).transfer(g.betAmount);
        payable(g.player2).transfer(g.betAmount);
    }
}