
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

// 공용 보스전 데이터베이스
db.exec(`
  CREATE TABLE IF NOT EXISTS boss_cycles (
    cycle_key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS world_bosses (
    cycle_key TEXT NOT NULL,
    boss_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    max_hp TEXT NOT NULL,
    current_hp TEXT NOT NULL,
    defeated INTEGER DEFAULT 0,
    PRIMARY KEY (cycle_key, boss_id)
  );

  CREATE TABLE IF NOT EXISTS boss_contributions (
    cycle_key TEXT NOT NULL,
    boss_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    damage TEXT NOT NULL DEFAULT '0',
    PRIMARY KEY (cycle_key, boss_id, player_id)
  );
  CREATE TABLE IF NOT EXISTS boss_player_states (
    cycle_key TEXT NOT NULL,
    boss_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    current_hp TEXT NOT NULL,
    max_hp TEXT NOT NULL,
    PRIMARY KEY (cycle_key, boss_id, player_id)
  );
`);

// 기존 game.db를 유지하면서 전투 능력치 JSON 열만 추가한다.
const playerColumns = db.prepare("PRAGMA table_info(players)").all().map(column => column.name);
if (!playerColumns.includes("stats_json")) {
  db.exec("ALTER TABLE players ADD COLUMN stats_json TEXT NOT NULL DEFAULT '{}'");
}

const players = new Map(
  db.prepare("SELECT * FROM players")
    .all()
    .map(player => {
      let stats = {};
      try { stats = JSON.parse(player.stats_json || '{}'); } catch {}
      return [player.id, { ...player, stats }];
    })
);
const queue = [];
const matches = new Map();

app.get("/", (req, res) => {
  res.send("분신 키우기 서버 실행 중!");
});

const BOSS_NAMES = [
  '고대의 화염룡', '심연의 해신', '천공의 거신',
  '망각의 수호자', '칠흑의 늑대왕', '시간의 파수꾼',
  '별을 삼키는 자', '영원의 골렘', '폭풍의 군주',
  '황혼의 여왕', '태초의 정령', '심판의 기계신',
  '빙하의 제왕', '독안개 군주', '차원의 포식자',
  '무한의 그림자', '태양의 수호룡', '달의 마녀왕',
  '혼돈의 군주', '창세의 용'
];

function getBossCycle() {
  const now = new Date();
  const korea = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })
  );

  const hour = korea.getHours();
  const start = new Date(korea);

  if (hour < 10) {
    start.setDate(start.getDate() - 1);
    start.setHours(22, 0, 0, 0);
  } else if (hour < 22) {
    start.setHours(10, 0, 0, 0);
  } else {
    start.setHours(22, 0, 0, 0);
  }

  return start.toISOString();
}

function ensureBosses() {
  const cycle = getBossCycle();

  const existing = db.prepare(
    'SELECT COUNT(*) AS count FROM world_bosses WHERE cycle_key = ?'
  ).get(cycle);

  if (existing.count === 0) {
    const pool = [...BOSS_NAMES];

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const insert = db.prepare(`
      INSERT INTO world_bosses
      (cycle_key, boss_id, name, max_hp, current_hp)
      VALUES (?, ?, ?, ?, ?)
    `);

    const create = db.transaction(() => {
      for (let i = 0; i < 3; i++) {
        const hp = '1000000000';
        insert.run(cycle, i + 1, pool[i], hp, hp);
      }
    });

    create();
  }

  return cycle;
}

// 현재 공용 보스 3종 조회
app.get('/api/bosses', (req, res) => {
  try {
    const cycle = ensureBosses();

    const bosses = db.prepare(`
      SELECT boss_id, name, max_hp, current_hp, defeated
      FROM world_bosses
      WHERE cycle_key = ?
      ORDER BY boss_id
    `).all(cycle);

    res.json({ success: true, cycle, bosses });
  } catch (error) {
    console.error('보스 조회 오류:', error);
    res.status(500).json({ error: '보스 정보를 불러오지 못했어.' });
  }
});
// 보스전 입장 및 플레이어 체력 불러오기
app.post('/api/bosses/:bossId/join', (req, res) => {
  try {
    const playerId = String(req.body.id || '');
    const bossId = Number(req.params.bossId);
    const player = players.get(playerId);

    if (!player) return res.status(404).json({ error: '먼저 온라인 서버에 접속해 줘.' });
    if (!Number.isInteger(bossId) || bossId < 1 || bossId > 3) {
      return res.status(400).json({ error: '잘못된 보스 번호야.' });
    }

    const cycle = ensureBosses();
    const boss = db.prepare(`
      SELECT * FROM world_bosses
      WHERE cycle_key = ? AND boss_id = ?
    `).get(cycle, bossId);

    if (!boss || boss.defeated) {
      return res.status(400).json({ error: '전투할 수 없는 보스야.' });
    }

    const stats = player.stats || {};
    let maxHpValue;
    try { maxHpValue = BigInt(stats.hp || '1000'); } catch { maxHpValue = 1000n; }
    if (maxHpValue < 1n) maxHpValue = 1n;
    const maxHp = maxHpValue.toString();
    let state = db.prepare(`
      SELECT current_hp, max_hp FROM boss_player_states
      WHERE cycle_key = ? AND boss_id = ? AND player_id = ?
    `).get(cycle, bossId, playerId);

    if (!state) {
      db.prepare(`
        INSERT INTO boss_player_states
        (cycle_key, boss_id, player_id, current_hp, max_hp)
        VALUES (?, ?, ?, ?, ?)
      `).run(cycle, bossId, playerId, maxHp, maxHp);
      state = { current_hp: maxHp, max_hp: maxHp };
    } else if (state.max_hp === '1000') {
      // 구버전에서 저장된 기본 체력 1000은 새 분신의 최대 체력으로 이전한다.
      const oldMax = 1000n;
      const oldCurrent = BigInt(state.current_hp);
      const migratedCurrent = oldCurrent * maxHpValue / oldMax;
      db.prepare(`
        UPDATE boss_player_states SET current_hp = ?, max_hp = ?
        WHERE cycle_key = ? AND boss_id = ? AND player_id = ?
      `).run(migratedCurrent.toString(), maxHp, cycle, bossId, playerId);
      state = { current_hp: migratedCurrent.toString(), max_hp: maxHp };
    }

    const contribution = db.prepare(`
      SELECT damage FROM boss_contributions
      WHERE cycle_key = ? AND boss_id = ? AND player_id = ?
    `).get(cycle, bossId, playerId);

    res.json({
      success: true,
      boss: {
        boss_id: boss.boss_id, name: boss.name,
        current_hp: boss.current_hp, max_hp: boss.max_hp,
        defeated: Boolean(boss.defeated)
      },
      currentHp: state.current_hp,
      maxHp: state.max_hp,
      contribution: contribution?.damage || '0'
    });
  } catch (error) {
    console.error('보스전 입장 오류:', error);
    res.status(500).json({ error: '보스전 입장에 실패했어.' });
  }
});

// 보스 공격: 서버에서 매 공격마다 능력치 ±30을 굴린다.
// 최대 체력과 치명타 확률은 원래 값을 그대로 사용한다.
app.post('/api/bosses/:bossId/attack', (req, res) => {
  try {
    const playerId = String(req.body.id || '');
    const bossId = Number(req.params.bossId);
    const player = players.get(playerId);

    if (!player) return res.status(404).json({ error: '플레이어를 찾을 수 없어.' });
    if (!Number.isInteger(bossId) || bossId < 1 || bossId > 3) {
      return res.status(400).json({ error: '잘못된 보스 번호야.' });
    }

    const cycle = ensureBosses();
    const boss = db.prepare(`
      SELECT * FROM world_bosses
      WHERE cycle_key = ? AND boss_id = ?
    `).get(cycle, bossId);

    if (!boss) return res.status(404).json({ error: '보스를 찾을 수 없어.' });
    if (boss.defeated) return res.json({ success: false, message: '이미 쓰러진 보스야.' });

    const state = db.prepare(`
      SELECT current_hp, max_hp FROM boss_player_states
      WHERE cycle_key = ? AND boss_id = ? AND player_id = ?
    `).get(cycle, bossId, playerId);
    if (!state) return res.status(400).json({ error: '먼저 보스전에 입장해 줘.' });
    if (BigInt(state.current_hp) <= 0n) {
      return res.status(400).json({ error: '체력이 모두 소진됐어. 이번 주기의 보스전은 더 진행할 수 없어.' });
    }

    const sourceStats = player.stats || {};
    const base = key => {
      try { return BigInt(sourceStats[key] ?? 0); } catch { return 0n; }
    };
    const roll = key => {
      const value = base(key) + BigInt(Math.floor(Math.random() * 61) - 30);
      return value > 0n ? value : 0n;
    };

    // hp와 crit은 고정, 나머지 능력치는 각 공격 시 -30~+30 변동.
    const combat = {
      hp: base('hp'),
      atk: roll('atk'),
      def: roll('def'),
      spd: roll('spd'),
      crit: base('crit'),
      critDmg: roll('critDmg'),
      acc: roll('acc'),
      evade: roll('evade'),
      pen: roll('pen'),
      life: roll('life'),
      regen: roll('regen'),
      luck: roll('luck')
    };

    const bossMax = BigInt(boss.max_hp);
    const oldBossHp = BigInt(boss.current_hp);
    const oldPlayerHp = BigInt(state.current_hp);
    const bossDefense = 10n;
    const luckBonus = combat.luck >= 1000n ? 10 : Number(combat.luck / 100n);
    const hitChance = Math.max(1, Math.min(99, Number(combat.acc > 99n ? 99n : combat.acc) + luckBonus));
    const missed = Math.random() * 100 >= hitChance;
    const critical = !missed && Math.random() * 100 < Math.max(0, Math.min(95, Number(combat.crit > 95n ? 95n : combat.crit)));

    let damage = 0n;
    if (!missed) {
      damage = combat.atk + (critical ? combat.atk * combat.critDmg / 100n : 0n);
      const defenseAfterPen = bossDefense > combat.pen ? bossDefense - combat.pen : 0n;
      damage = damage > defenseAfterPen ? damage - defenseAfterPen : 1n;
    }
    if (damage > oldBossHp) damage = oldBossHp;
    const newBossHp = oldBossHp - damage;
    const defeated = newBossHp === 0n ? 1 : 0;

    const speedBonus = combat.spd >= 200n ? 20 : Number(combat.spd / 10n);
    const evasionChance = Math.max(0, Math.min(95, Number(combat.evade > 95n ? 95n : combat.evade) + speedBonus));
    const evaded = newBossHp > 0n && Math.random() * 100 < evasionChance;
    const rawBossDamage = 100n;
    const bossDamage = newBossHp === 0n || evaded
      ? 0n
      : (rawBossDamage > combat.def ? rawBossDamage - combat.def : 1n);
    let newPlayerHp = oldPlayerHp > bossDamage ? oldPlayerHp - bossDamage : 0n;
    const healing = damage * combat.life / 100n + combat.regen;
    if (healing > 0n && newPlayerHp > 0n) {
      const maxHp = BigInt(state.max_hp);
      newPlayerHp = newPlayerHp + healing > maxHp ? maxHp : newPlayerHp + healing;
    }

    const oldContribution = db.prepare(`
      SELECT damage FROM boss_contributions
      WHERE cycle_key = ? AND boss_id = ? AND player_id = ?
    `).get(cycle, bossId, playerId);
    const totalDamage = BigInt(oldContribution?.damage || '0') + damage;

    const saveAttack = db.transaction(() => {
      db.prepare(`
        UPDATE world_bosses SET current_hp = ?, defeated = ?
        WHERE cycle_key = ? AND boss_id = ?
      `).run(newBossHp.toString(), defeated, cycle, bossId);

      db.prepare(`
        UPDATE boss_player_states SET current_hp = ?
        WHERE cycle_key = ? AND boss_id = ? AND player_id = ?
      `).run(newPlayerHp.toString(), cycle, bossId, playerId);

      db.prepare(`
        INSERT INTO boss_contributions (cycle_key, boss_id, player_id, damage)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cycle_key, boss_id, player_id)
        DO UPDATE SET damage = excluded.damage
      `).run(cycle, bossId, playerId, totalDamage.toString());
    });
    saveAttack();

    res.json({
      success: true,
      damage: damage.toString(),
      currentHp: newBossHp.toString(),
      maxBossHp: bossMax.toString(),
      defeated: Boolean(defeated),
      critical,
      missed,
      playerHp: newPlayerHp.toString(),
      playerMaxHp: state.max_hp,
      bossDamage: bossDamage.toString(),
      evaded,
      healing: healing.toString(),
      contribution: totalDamage.toString(),
      combatStats: Object.fromEntries(Object.entries(combat).map(([key, value]) => [key, value.toString()]))
    });
  } catch (error) {
    console.error('보스 공격 오류:', error);
    res.status(500).json({ error: '보스 공격 중 오류가 발생했어.' });
  }
});

// 플레이어 등록 및 최신 분신 능력치 저장
app.post("/api/register", (req, res) => {
  const { id, name, heroName, rank, power, stats } = req.body;
  if (!id || !name) return res.status(400).json({ error: "정보가 부족해." });

  const old = players.get(id);
  const cleanStats = {};
  const allowedStats = ['hp','atk','def','spd','crit','critDmg','acc','evade','pen','life','regen','luck'];
  for (const key of allowedStats) {
    try {
      const value = BigInt(stats?.[key] ?? old?.stats?.[key] ?? 0);
      cleanStats[key] = (value < 0n ? 0n : value).toString();
    } catch {
      cleanStats[key] = String(old?.stats?.[key] || '0');
    }
  }

  const player = {
    id,
    name: String(name).slice(0, 16),
    heroName: String(heroName || "").slice(0, 14),
    rank: Number(rank) || 15,
    power: String(power || "0"),
    wins: old ? old.wins : 0,
    stats: cleanStats
  };
  players.set(id, player);

  db.prepare(`
    INSERT INTO players (id, name, heroName, rank, power, wins, stats_json)
    VALUES (@id, @name, @heroName, @rank, @power, @wins, @stats_json)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      heroName = excluded.heroName,
      rank = excluded.rank,
      power = excluded.power,
      stats_json = excluded.stats_json
  `).run({ ...player, stats_json: JSON.stringify(cleanStats) });

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

