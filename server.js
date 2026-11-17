
const express = require("express");
const Database = require("better-sqlite3");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

const db = new Database("game.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    heroName TEXT,
    rank INTEGER,
    power TEXT,
    wins INTEGER DEFAULT 0
  )
`);

const players = new Map(
  db.prepare("SELECT * FROM players")
    .all()
    .map(player => [player.id, player])
);
const queue = [];
const matches = new Map();

app.get("/", (req, res) => {
  res.send("분신 키우기 서버 실행 중!");
});

// 플레이어 등록
app.post("/api/register", (req, res) => {
  const { id, name, heroName, rank, power } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: "정보가 부족해." });
  }

  const old = players.get(id);

  const player = {
    id,
    name: String(name).slice(0, 16),
    heroName: String(heroName || "").slice(0, 14),
    rank: Number(rank) || 15,
    power: String(power || "0"),
    wins: old ? old.wins : 0
  };

  players.set(id, player);

  db.prepare(`
    INSERT INTO players (id, name, heroName, rank, power, wins)
    VALUES (@id, @name, @heroName, @rank, @power, @wins)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      heroName = excluded.heroName,
      rank = excluded.rank,
      power = excluded.power
  `).run(player);

 res.json({ success: true });
});

// 랜덤 대전 대기
app.post("/api/queue", (req, res) => {
  const { id } = req.body;
  const player = players.get(id);

  if (!player) {
    return res.status(404).json({ error: "먼저 서버에 접속해 줘." });
  }

  if (queue.includes(id)) {
    return res.json({ success: true, matched: false });
  }

  const index = queue.findIndex(x => x !== id);

  if (index === -1) {
    queue.push(id);
    return res.json({ success: true, matched: false });
  }

  const opponentId = queue.splice(index, 1)[0];
  const opponent = players.get(opponentId);

  if (!opponent) {
    queue.push(id);
    return res.json({ success: true, matched: false });
  }

  const a = BigInt(player.power);
  const b = BigInt(opponent.power);
  const win = a >= b;

 if (win) {
  player.wins++;

  db.prepare(`
    UPDATE players
    SET wins = ?
    WHERE id = ?
  `).run(player.wins, player.id);

} else {
  opponent.wins++;

  db.prepare(`
    UPDATE players
    SET wins = ?
    WHERE id = ?
  `).run(opponent.wins, opponent.id);
}

  matches.set(id, {
    opponent,
    result: win ? "win" : "lose",
    reward: win ? 100 : 0,
    summary: "전투력 비교로 결정된 테스트 대전이야."
  });

  matches.set(opponentId, {
    opponent: player,
    result: win ? "lose" : "win",
    reward: win ? 0 : 100,
    summary: "전투력 비교로 결정된 테스트 대전이야."
  });

  res.json({ success: true, matched: true });
});

// 닉네임 대결
app.post("/api/challenge", (req, res) => {
  const { id, targetName } = req.body;
  const player = players.get(id);

  const opponent = [...players.values()].find(
    p => p.name === targetName && p.id !== id
  );

  if (!player || !opponent) {
    return res.status(404).json({
      error: "상대 플레이어를 찾을 수 없어."
    });
  }

  const win = BigInt(player.power) >= BigInt(opponent.power);

  if (win) player.wins++;
  else opponent.wins++;

  matches.set(id, {
    opponent,
    result: win ? "win" : "lose",
    reward: win ? 100 : 0,
    summary: "전투력 비교로 결정된 테스트 대전이야."
  });

  matches.set(opponent.id, {
    opponent: player,
    result: win ? "lose" : "win",
    reward: win ? 0 : 100,
    summary: "전투력 비교로 결정된 테스트 대전이야."
  });

  res.json({ success: true, opponent });
});

// 대기 취소
app.post("/api/cancel", (req, res) => {
  const { id } = req.body;
  const index = queue.indexOf(id);

  if (index !== -1) queue.splice(index, 1);

  res.json({ success: true });
});

// 대전 결과
app.get("/api/match/:id", (req, res) => {
  const match = matches.get(req.params.id);

  if (!match) return res.json({ match: null });

  matches.delete(req.params.id);
  res.json({ match });
});

// 랭킹
app.get("/api/rankings", (req, res) => {
  const ranking = [...players.values()]
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;

      const pa = BigInt(a.power);
      const pb = BigInt(b.power);

      if (pa > pb) return -1;
      if (pa < pb) return 1;
      return 0;
    })
    .slice(0, 100);

  res.json({ players: ranking });
});

// 채팅
io.on("connection", socket => {
  console.log("플레이어 접속:", socket.id);

  socket.on("chat", message => {
    if (typeof message !== "string") return;

    const safeMessage = message.trim().slice(0, 200);
    if (!safeMessage) return;

    io.emit("chat", {
      player: "플레이어",
      message: safeMessage
    });
  });

  socket.on("disconnect", () => {
    console.log("접속 종료:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`서버 실행 중: 포트 ${PORT}`);
});
