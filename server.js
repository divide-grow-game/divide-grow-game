
const express = require("express");
const { Pool } = require("pg");
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

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 환경 변수가 설정되지 않았어.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

const players = new Map();
const queue = [];
const matches = new Map();

const BOSS_NAMES = [
  "고대의 화염룡", "심연의 해신", "천공의 거신",
  "망각의 수호자", "칠흑의 늑대왕", "시간의 파수꾼",
  "별을 삼키는 자", "영원의 골렘", "폭풍의 군주",
  "황혼의 여왕", "태초의 정령", "심판의 기계신",
  "빙하의 제왕", "독안개 군주", "차원의 포식자",
  "무한의 그림자", "태양의 수호룡", "달의 마녀왕",
  "혼돈의 군주", "창세의 용"
];

const BOSS_DATA = {
  '고대의 화염룡': {
    recommendedPower: '50000',
    minDamage: 30000,
    maxDamage: 500000,
    skills: [
      { name: '용암 폭발', description: '플레이어에게 추가 피해를 주는 화염 공격!', type: 'burn' },
      { name: '화염의 숨결', description: '3턴 동안 플레이어의 공격력을 낮춘다!', type: 'weaken' }
    ]
  },
  '심연의 해신': {
    recommendedPower: '100000',
    minDamage: 50000,
    maxDamage: 1000000,
    skills: [
      { name: '심해의 속박', description: '플레이어의 움직임을 2턴 동안 봉쇄한다!', type: 'freeze' },
      { name: '해일', description: '플레이어에게 강력한 추가 피해를 준다!', type: 'drain' }
    ]
  },
  '천공의 거신': {
    recommendedPower: '200000',
    minDamage: 100000,
    maxDamage: 1500000,
    skills: [
      { name: '천공 강타', description: '플레이어의 방어력을 3턴 동안 낮춘다!', type: 'defenseDown' },
      { name: '거신의 압박', description: '플레이어의 공격을 1턴 동안 봉쇄한다!', type: 'freeze' }
    ]
  },
  '망각의 수호자': {
    recommendedPower: '350000',
    minDamage: 150000,
    maxDamage: 2000000,
    skills: [
      { name: '기억 삭제', description: '플레이어의 공격력을 3턴 동안 낮춘다!', type: 'weaken' },
      { name: '망각의 저주', description: '플레이어의 회복을 3턴 동안 막는다!', type: 'healBlock' }
    ]
  },
  '칠흑의 늑대왕': {
    recommendedPower: '500000',
    minDamage: 200000,
    maxDamage: 2500000,
    skills: [
      { name: '그림자 습격', description: '플레이어에게 추가 피해를 준다!', type: 'drain' },
      { name: '늑대왕의 포효', description: '플레이어의 회피 능력을 3턴 동안 낮춘다!', type: 'slow' }
    ]
  },
  '시간의 파수꾼': {
    recommendedPower: '750000',
    minDamage: 300000,
    maxDamage: 3000000,
    skills: [
      { name: '시간 정지', description: '플레이어를 3턴 동안 얼어붙게 만든다!', type: 'freeze' },
      { name: '시간 역행', description: '보스의 체력을 일부 회복한다!', type: 'bossHeal' }
    ]
  },
  '별을 삼키는 자': {
    recommendedPower: '1000000',
    minDamage: 400000,
    maxDamage: 3500000,
    skills: [
      { name: '성운 폭발', description: '플레이어에게 지속 피해를 준다!', type: 'poison' },
      { name: '중력 붕괴', description: '플레이어의 방어력을 3턴 동안 낮춘다!', type: 'defenseDown' }
    ]
  },
  '영원의 골렘': {
    recommendedPower: '1500000',
    minDamage: 500000,
    maxDamage: 4000000,
    skills: [
      { name: '영원의 방벽', description: '보스가 2턴 동안 받는 피해를 줄인다!', type: 'shield' },
      { name: '대지 분쇄', description: '플레이어에게 강력한 추가 피해를 준다!', type: 'drain' }
    ]
  },
  '폭풍의 군주': {
    recommendedPower: '2000000',
    minDamage: 600000,
    maxDamage: 4500000,
    skills: [
      { name: '천둥 강타', description: '플레이어에게 지속 피해를 준다!', type: 'burn' },
      { name: '폭풍의 감옥', description: '플레이어의 움직임을 2턴 동안 봉쇄한다!', type: 'freeze' }
    ]
  },
  '황혼의 여왕': {
    recommendedPower: '3000000',
    minDamage: 700000,
    maxDamage: 5000000,
    skills: [
      { name: '황혼의 저주', description: '플레이어의 회복을 3턴 동안 막는다!', type: 'healBlock' },
      { name: '어둠의 유혹', description: '플레이어의 공격력을 3턴 동안 낮춘다!', type: 'weaken' }
    ]
  },
  '태초의 정령': {
    recommendedPower: '4000000',
    minDamage: 800000,
    maxDamage: 5500000,
    skills: [
      { name: '원초의 파동', description: '플레이어의 방어력을 3턴 동안 낮춘다!', type: 'defenseDown' },
      { name: '생명의 역류', description: '보스가 체력을 일부 회복한다!', type: 'bossHeal' }
    ]
  },
  '심판의 기계신': {
    recommendedPower: '5000000',
    minDamage: 1000000,
    maxDamage: 6000000,
    skills: [
      { name: '심판 광선', description: '플레이어에게 지속 피해를 준다!', type: 'poison' },
      { name: '전투 시스템 교란', description: '플레이어의 공격력을 3턴 동안 낮춘다!', type: 'weaken' }
    ]
  },
  '빙하의 제왕': {
    recommendedPower: '7000000',
    minDamage: 1200000,
    maxDamage: 6500000,
    skills: [
      { name: '절대 영하', description: '플레이어를 3턴 동안 얼려 공격할 수 없게 만든다!', type: 'freeze' },
      { name: '빙하 감옥', description: '플레이어의 회피 능력을 3턴 동안 낮춘다!', type: 'slow' }
    ]
  },
  '독안개 군주': {
    recommendedPower: '9000000',
    minDamage: 1500000,
    maxDamage: 7000000,
    skills: [
      { name: '맹독 안개', description: '플레이어에게 3턴 동안 지속 피해를 준다!', type: 'poison' },
      { name: '약화 독소', description: '플레이어의 공격력을 3턴 동안 낮춘다!', type: 'weaken' }
    ]
  },
  '차원의 포식자': {
    recommendedPower: '12000000',
    minDamage: 1800000,
    maxDamage: 7500000,
    skills: [
      { name: '차원 균열', description: '플레이어의 방어력을 3턴 동안 낮춘다!', type: 'defenseDown' },
      { name: '공간 포식', description: '플레이어에게 강력한 추가 피해를 준다!', type: 'drain' }
    ]
  },
  '무한의 그림자': {
    recommendedPower: '15000000',
    minDamage: 2000000,
    maxDamage: 8000000,
    skills: [
      { name: '그림자 속박', description: '플레이어를 2턴 동안 움직이지 못하게 만든다!', type: 'freeze' },
      { name: '무한의 저주', description: '플레이어의 회복을 3턴 동안 막는다!', type: 'healBlock' }
    ]
  },
  '태양의 수호룡': {
    recommendedPower: '20000000',
    minDamage: 2500000,
    maxDamage: 8500000,
    skills: [
      { name: '태양 폭발', description: '플레이어에게 지속 피해를 준다!', type: 'burn' },
      { name: '광휘의 방패', description: '보스가 2턴 동안 받는 피해를 줄인다!', type: 'shield' }
    ]
  },
  '달의 마녀왕': {
    recommendedPower: '25000000',
    minDamage: 3000000,
    maxDamage: 9000000,
    skills: [
      { name: '월식의 저주', description: '플레이어의 공격력을 3턴 동안 낮춘다!', type: 'weaken' },
      { name: '달빛 봉인', description: '플레이어의 회복을 3턴 동안 막는다!', type: 'healBlock' }
    ]
  },
  '혼돈의 군주': {
    recommendedPower: '30000000',
    minDamage: 3500000,
    maxDamage: 9500000,
    skills: [
      { name: '혼돈의 파동', description: '플레이어의 공격과 방어를 약화한다!', type: 'confuse' },
      { name: '혼돈의 폭발', description: '플레이어에게 지속 피해를 준다!', type: 'poison' }
    ]
  },
  '창세의 용': {
    recommendedPower: '50000000',
    minDamage: 4000000,
    maxDamage: 10000000,
    skills: [
      { name: '창세의 심판', description: '플레이어를 3턴 동안 얼려 공격할 수 없게 만든다!', type: 'freeze' },
      { name: '세계의 종말', description: '플레이어의 방어력을 낮추고 지속 피해를 준다!', type: 'poison' }
    ]
  }
};

const ALLOWED_STATS = [
  "hp", "atk", "def", "spd", "crit", "critDmg",
  "acc", "evade", "pen", "life", "regen", "luck"
];

// 보스전 테스트 모드
const BOSS_TEST_MODE = true;
const BOSS_TEST_HP = 1000000000000n;

function toPlayer(row) {
  if (!row) return null;
  let stats = {};
  try {
    stats = typeof row.stats_json === "string"
      ? JSON.parse(row.stats_json || "{}")
      : (row.stats_json || {});
  } catch {
    stats = {};
  }

  return {
    id: row.id,
    name: row.name,
    heroName: row.heroName || "",
    rank: Number(row.rank) || 15,
    power: String(row.power || "0"),
    wins: Number(row.wins) || 0,
    stats
  };
}

async function getPlayer(id) {
  const result = await pool.query(
    'SELECT id, name, "heroName", rank, power, wins, stats_json FROM players WHERE id = $1',
    [String(id || "")]
  );
  const player = toPlayer(result.rows[0]);
  if (player) players.set(player.id, player);
  return player;
}

function safeBigInt(value, fallback = 0n) {
  try {
    return BigInt(value ?? fallback);
  } catch {
    return fallback;
  }
}

function getBossCycle() {
  const koreaTime = new Date(Date.now() + 9 * 60 * 60 * 1000);

  const year = koreaTime.getUTCFullYear();
  const month = koreaTime.getUTCMonth();
  const date = koreaTime.getUTCDate();
  const hour = koreaTime.getUTCHours();

  const startHour = hour < 10 ? -2 : hour < 22 ? 10 : 22;

  return new Date(
    Date.UTC(year, month, date, startHour, 0, 0) -
    9 * 60 * 60 * 1000
  ).toISOString();
}

async function ensureBosses(client = pool) {
  const cycle = getBossCycle();
  const existing = await client.query(
    "SELECT COUNT(*)::int AS count FROM world_bosses WHERE cycle_key = $1",
    [cycle]
  );

  if (Number(existing.rows[0].count) === 0) {
    const shuffled = [...BOSS_NAMES];

    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    await client.query(
      "INSERT INTO boss_cycles (cycle_key, created_at) VALUES ($1, $2) ON CONFLICT (cycle_key) DO NOTHING",
      [cycle, new Date().toISOString()]
    );

    for (let i = 0; i < 3; i++) {
      const hp = "1000000000";

      await client.query(
        `INSERT INTO world_bosses
          (cycle_key, boss_id, name, max_hp, current_hp, defeated)
         VALUES ($1, $2, $3, $4, $4, 0)
         ON CONFLICT (cycle_key, boss_id) DO NOTHING`,
        [cycle, i + 1, shuffled[i], hp]
      );
    }
  }

  return cycle;
}

async function initialiseDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      "heroName" TEXT,
      rank INTEGER,
      power TEXT,
      wins INTEGER NOT NULL DEFAULT 0,
      stats_json TEXT NOT NULL DEFAULT '{}'
    );

    ALTER TABLE players ADD COLUMN IF NOT EXISTS "heroName" TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS rank INTEGER;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS power TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS stats_json TEXT NOT NULL DEFAULT '{}';

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
      defeated INTEGER NOT NULL DEFAULT 0,
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

    -- 플레이어 재료 보관함
    CREATE TABLE IF NOT EXISTS player_materials (
      player_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      material_name TEXT NOT NULL,
      quantity BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, material_id)
    );

    -- 플레이어 물약 보관함
    CREATE TABLE IF NOT EXISTS player_potions (
      id BIGSERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      potion_id TEXT NOT NULL,
      potion_name TEXT NOT NULL,
      tier INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      effects_json TEXT NOT NULL DEFAULT '{}',
      duration_turns INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (player_id, potion_id)
    );

    -- 물약 제작 기록
    CREATE TABLE IF NOT EXISTS potion_crafting_log (
      id BIGSERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      potion_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 일일 퀘스트 목록
    CREATE TABLE IF NOT EXISTS daily_quest_templates (
      quest_id INTEGER PRIMARY KEY,
      quest_name TEXT NOT NULL,
      description TEXT NOT NULL,
      quest_type TEXT NOT NULL,
      target_value BIGINT NOT NULL,
      reward_json TEXT NOT NULL DEFAULT '{}'
    );

    -- 날짜별 플레이어 퀘스트
    CREATE TABLE IF NOT EXISTS player_daily_quests (
      player_id TEXT NOT NULL,
      quest_date DATE NOT NULL,
      quest_id INTEGER NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (player_id, quest_date, quest_id)
    );

    -- 길드
    CREATE TABLE IF NOT EXISTS guilds (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(24) NOT NULL UNIQUE,
      leader_id TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 1,
      experience BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 길드 가입 정보
    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      contribution BIGINT NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, player_id)
    );

    -- 길드 대항전
    CREATE TABLE IF NOT EXISTS guild_battles (
      id BIGSERIAL PRIMARY KEY,
      guild_a BIGINT NOT NULL REFERENCES guilds(id),
      guild_b BIGINT NOT NULL REFERENCES guilds(id),
      status TEXT NOT NULL DEFAULT 'waiting',
      score_a BIGINT NOT NULL DEFAULT 0,
      score_b BIGINT NOT NULL DEFAULT 0,
      winner_guild BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );

    -- 길드 전용 보스
    CREATE TABLE IF NOT EXISTS guild_bosses (
      id BIGSERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      boss_name TEXT NOT NULL,
      max_hp TEXT NOT NULL,
      current_hp TEXT NOT NULL,
      defeated BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 길드 보스 기여도
    CREATE TABLE IF NOT EXISTS guild_boss_contributions (
      boss_id BIGINT NOT NULL REFERENCES guild_bosses(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL,
      damage TEXT NOT NULL DEFAULT '0',
      PRIMARY KEY (boss_id, player_id)
    );

    -- 던전 진행 기록
    CREATE TABLE IF NOT EXISTS dungeon_runs (
      id BIGSERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      dungeon_level BIGINT NOT NULL,
      current_round INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );

    -- 파티
    CREATE TABLE IF NOT EXISTS parties (
      id BIGSERIAL PRIMARY KEY,
      leader_id TEXT NOT NULL,
      party_type TEXT NOT NULL DEFAULT 'battle',
      status TEXT NOT NULL DEFAULT 'recruiting',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 파티원
    CREATE TABLE IF NOT EXISTS party_members (
      party_id BIGINT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL UNIQUE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (party_id, player_id)
    );

    -- 파티 전투 기록
    CREATE TABLE IF NOT EXISTS party_battles (
      id BIGSERIAL PRIMARY KEY,
      party_id BIGINT NOT NULL REFERENCES parties(id),
      battle_type TEXT NOT NULL,
      target_level BIGINT,
      current_round INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      reward_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 온라인 PvP 전투 기록
    CREATE TABLE IF NOT EXISTS pvp_battles (
      id BIGSERIAL PRIMARY KEY,
      player_a TEXT NOT NULL,
      player_b TEXT NOT NULL,
      winner_id TEXT,
      battle_log JSONB NOT NULL DEFAULT '[]',
      reward_json JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_daily_quests_player_date
      ON player_daily_quests(player_id, quest_date);

    CREATE INDEX IF NOT EXISTS idx_guild_members_guild
      ON guild_members(guild_id);

    CREATE INDEX IF NOT EXISTS idx_guilds_level
      ON guilds(level DESC, experience DESC);

    CREATE INDEX IF NOT EXISTS idx_dungeon_player
      ON dungeon_runs(player_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_pvp_battles_players
      ON pvp_battles(player_a, player_b);
  `);

  await pool.query(`
    ALTER TABLE boss_player_states
    ADD COLUMN IF NOT EXISTS status_json TEXT NOT NULL DEFAULT '{}'
  `);

  const result = await pool.query(
    'SELECT id, name, "heroName", rank, power, wins, stats_json FROM players'
  );

  players.clear();

  for (const row of result.rows) {
    const player = toPlayer(row);
    if (player) players.set(player.id, player);
  }

  await ensureBosses();

  console.log(
    \`PostgreSQL 연결 완료: 플레이어 \${players.size}명 불러옴\`
  );
}

    ALTER TABLE players ADD COLUMN IF NOT EXISTS "heroName" TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS rank INTEGER;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS power TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS stats_json TEXT NOT NULL DEFAULT '{}';

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
      defeated INTEGER NOT NULL DEFAULT 0,
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

  await pool.query(`
    ALTER TABLE boss_player_states
    ADD COLUMN IF NOT EXISTS status_json TEXT NOT NULL DEFAULT '{}'
  `);

  const result = await pool.query(
    'SELECT id, name, "heroName", rank, power, wins, stats_json FROM players'
  );

  players.clear();

  for (const row of result.rows) {
    const player = toPlayer(row);
    if (player) players.set(player.id, player);
  }

  await ensureBosses();

  console.log(
    `PostgreSQL 연결 완료: 플레이어 ${players.size}명 불러옴`
  );
}

app.get("/", (req, res) => {
  res.send("분신 키우기 서버 실행 중!");
});

app.get("/api/bosses", async (req, res) => {
  try {
    const cycle = await ensureBosses();
    const result = await pool.query(
      `SELECT boss_id, name, max_hp, current_hp, defeated
       FROM world_bosses
       WHERE cycle_key = $1
       ORDER BY boss_id`,
      [cycle]
    );

    res.json({
      success: true,
      cycle,
      bosses: result.rows.map(boss => ({
        ...boss,
        recommendedPower: BOSS_DATA[boss.name]?.recommendedPower || "0",
        skills: BOSS_DATA[boss.name]?.skills || [],
        defeated: Boolean(Number(boss.defeated))
      }))
    });
  } catch (error) {
    console.error("보스 조회 오류:", error);
    res.status(500).json({ error: "보스 정보를 불러오지 못했어." });
  }
});

app.post("/api/bosses/:bossId/join", async (req, res) => {
  try {
    const playerId = String(req.body.id || "");
    const bossId = Number(req.params.bossId);
    const player = await getPlayer(playerId);

    if (!player) {
      return res.status(404).json({ error: "먼저 온라인 서버에 접속해 줘." });
    }
    if (!Number.isInteger(bossId) || bossId < 1 || bossId > 3) {
      return res.status(400).json({ error: "잘못된 보스 번호야." });
    }

    const cycle = await ensureBosses();
    const bossResult = await pool.query(
      `SELECT * FROM world_bosses
       WHERE cycle_key = $1 AND boss_id = $2`,
      [cycle, bossId]
    );
    const boss = bossResult.rows[0];

    if (!boss || Number(boss.defeated) === 1) {
      return res.status(400).json({ error: "전투할 수 없는 보스야." });
    }

    let maxHpValue = BOSS_TEST_MODE
      ? BOSS_TEST_HP
      : safeBigInt(player.stats?.hp || "1000", 1000n);
    if (maxHpValue < 1n) maxHpValue = 1n;
    const maxHp = maxHpValue.toString();

    let stateResult = await pool.query(
      `SELECT current_hp, max_hp, status_json FROM boss_player_states
       WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3`,
      [cycle, bossId, playerId]
    );
    let state = stateResult.rows[0];

    if (BOSS_TEST_MODE) {
      await pool.query(
        `INSERT INTO boss_player_states
          (cycle_key, boss_id, player_id, current_hp, max_hp, status_json)
         VALUES ($1, $2, $3, $4, $4, '{}')
         ON CONFLICT (cycle_key, boss_id, player_id)
         DO UPDATE SET current_hp = EXCLUDED.current_hp,
                       max_hp = EXCLUDED.max_hp,
                       status_json = '{}'`,
        [cycle, bossId, playerId, maxHp]
      );

      state = {
        current_hp: maxHp,
        max_hp: maxHp,
        status_json: {}
      };
    } else if (!state) {
      await pool.query(
        `INSERT INTO boss_player_states
          (cycle_key, boss_id, player_id, current_hp, max_hp)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (cycle_key, boss_id, player_id) DO NOTHING`,
        [cycle, bossId, playerId, maxHp]
      );

      stateResult = await pool.query(
        `SELECT current_hp, max_hp, status_json FROM boss_player_states
         WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3`,
        [cycle, bossId, playerId]
      );
      state = stateResult.rows[0];
    } else if (state.max_hp === "1000") {
      const oldCurrent = safeBigInt(state.current_hp);
      const migratedCurrent = oldCurrent * maxHpValue / 1000n;

      await pool.query(
        `UPDATE boss_player_states SET current_hp = $1, max_hp = $2
         WHERE cycle_key = $3 AND boss_id = $4 AND player_id = $5`,
        [migratedCurrent.toString(), maxHp, cycle, bossId, playerId]
      );

      state = {
        current_hp: migratedCurrent.toString(),
        max_hp: maxHp
      };
    }

    const contributionResult = await pool.query(
      `SELECT damage FROM boss_contributions
       WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3`,
      [cycle, bossId, playerId]
    );

    res.json({
      success: true,
      boss: {
        boss_id: boss.boss_id,
        name: boss.name,
        current_hp: boss.current_hp,
        max_hp: boss.max_hp,
        recommendedPower: BOSS_DATA[boss.name]?.recommendedPower || "0",
        skills: BOSS_DATA[boss.name]?.skills || [],
        defeated: Boolean(Number(boss.defeated))
      },
      currentHp: state.current_hp,
      maxHp: state.max_hp,
      contribution: contributionResult.rows[0]?.damage || "0"
    });
  } catch (error) {
    console.error("보스전 입장 오류:", error);
    res.status(500).json({ error: "보스전 입장에 실패했어." });
  }
});

// 보스 공격
app.post("/api/bosses/:bossId/attack", async (req, res) => {
  const client = await pool.connect();

  try {
    const playerId = String(req.body.id || "");
    const bossId = Number(req.params.bossId);

    if (!Number.isInteger(bossId) || bossId < 1 || bossId > 3) {
      return res.status(400).json({ error: "잘못된 보스 번호야." });
    }

    const player = await getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: "플레이어를 찾을 수 없어." });
    }

    const cycle = await ensureBosses(client);
    await client.query("BEGIN");

    const bossResult = await client.query(
      `SELECT * FROM world_bosses
       WHERE cycle_key = $1 AND boss_id = $2 FOR UPDATE`,
      [cycle, bossId]
    );
    const boss = bossResult.rows[0];

    if (!boss) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "보스를 찾을 수 없어." });
    }

    if (Number(boss.defeated) === 1) {
      await client.query("ROLLBACK");
      return res.json({ success: false, message: "이미 쓰러진 보스야." });
    }

    const stateResult = await client.query(
      `SELECT current_hp, max_hp, status_json FROM boss_player_states
       WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3 FOR UPDATE`,
      [cycle, bossId, playerId]
    );
    const state = stateResult.rows[0];

    if (!state) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "먼저 보스전에 입장해 줘." });
    }

    // 테스트 모드에서는 기존 체력 저장값을 검사하고 필요하면 1조로 복구
    if (BOSS_TEST_MODE) {
      const savedHp = safeBigInt(state.current_hp);
      const savedMaxHp = safeBigInt(state.max_hp);

      if (savedHp <= 0n || savedMaxHp !== BOSS_TEST_HP) {
        await client.query(
          `UPDATE boss_player_states
           SET current_hp = $1, max_hp = $1
           WHERE cycle_key = $2 AND boss_id = $3 AND player_id = $4`,
          [BOSS_TEST_HP.toString(), cycle, bossId, playerId]
        );

        state.current_hp = BOSS_TEST_HP.toString();
        state.max_hp = BOSS_TEST_HP.toString();
      }
    }

    let playerStatus = {};

    try {
      playerStatus = typeof state.status_json === "string"
        ? JSON.parse(state.status_json || "{}")
        : (state.status_json || {});
    } catch {
      playerStatus = {};
    }

    if (safeBigInt(state.current_hp) <= 0n) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "체력이 모두 소진됐어. 보스전에 다시 입장해 줘."
      });
    }

    const sourceStats = player.stats || {};
    const base = key => safeBigInt(sourceStats[key] ?? 0);
    const roll = key => {
      const value = base(key) + BigInt(Math.floor(Math.random() * 61) - 30);
      return value > 0n ? value : 0n;
    };

    const combat = {
      hp: base("hp"),
      atk: roll("atk"),
      def: roll("def"),
      spd: roll("spd"),
      crit: base("crit"),
      critDmg: roll("critDmg"),
      acc: roll("acc"),
      evade: roll("evade"),
      pen: roll("pen"),
      life: roll("life"),
      regen: roll("regen"),
      luck: roll("luck")
    };

    const bossData = BOSS_DATA[boss.name] || {
      recommendedPower: "0",
      minDamage: 30000,
      maxDamage: 100000,
      skills: []
    };

    const bossMax = safeBigInt(boss.max_hp);
    const oldBossHp = safeBigInt(boss.current_hp);
    const oldPlayerHp = safeBigInt(state.current_hp);
    const bossDefense = 10n;
    const luckBonus = combat.luck >= 1000n ? 10 : Number(combat.luck / 100n);

    let statusDamage = 0n;
    for (const effect of ["burn", "poison"]) {
      const turnsKey = `${effect}Turns`;
      const damageKey = `${effect}Damage`;
      const turns = Math.max(0, Number(playerStatus[turnsKey] || 0));

      if (turns > 0) {
        statusDamage += safeBigInt(playerStatus[damageKey] || 0);
        playerStatus[turnsKey] = turns - 1;
        if (playerStatus[turnsKey] === 0) delete playerStatus[damageKey];
      }
    }

    let newPlayerHp = oldPlayerHp > statusDamage
      ? oldPlayerHp - statusDamage
      : 0n;

    const frozen = Number(playerStatus.freezeTurns || 0) > 0;
    if (frozen) playerStatus.freezeTurns--;

    const weakened = Number(playerStatus.weakenTurns || 0) > 0;
    if (weakened) playerStatus.weakenTurns--;

    const defenseReduced = Number(playerStatus.defenseDownTurns || 0) > 0;
    if (defenseReduced) playerStatus.defenseDownTurns--;

    const slowed = Number(playerStatus.slowTurns || 0) > 0;
    if (slowed) playerStatus.slowTurns--;

    const confused = Number(playerStatus.confuseTurns || 0) > 0;
    if (confused) playerStatus.confuseTurns--;

    const healBlocked = Number(playerStatus.healBlockTurns || 0) > 0;
    if (healBlocked) playerStatus.healBlockTurns--;

    const bossShielded = Number(playerStatus.bossShieldTurns || 0) > 0;
    if (bossShielded) playerStatus.bossShieldTurns--;

    const effectiveAtk = combat.atk *
      BigInt(confused ? 50 : weakened ? 70 : 100) / 100n;
    const effectiveDef = combat.def *
      BigInt(confused ? 50 : defenseReduced ? 50 : 100) / 100n;

    const hitChance = Math.max(
      1,
      Math.min(99, Number(combat.acc > 99n ? 99n : combat.acc) + luckBonus)
    );

    const missed = frozen || newPlayerHp <= 0n ||
      Math.random() * 100 >= hitChance;
    const critical = !missed &&
      Math.random() * 100 <
      Math.max(0, Math.min(95, Number(combat.crit > 95n ? 95n : combat.crit)));

    let damage = 0n;

    if (!missed) {
      damage = effectiveAtk +
        (critical ? effectiveAtk * combat.critDmg / 100n : 0n);

      const defenseAfterPen = bossDefense > combat.pen
        ? bossDefense - combat.pen
        : 0n;

      damage = damage > defenseAfterPen
        ? damage - defenseAfterPen
        : 1n;
    }

    if (bossShielded) damage = damage / 2n;
    if (damage > oldBossHp) damage = oldBossHp;

    let newBossHp = oldBossHp - damage;
    const defeated = newBossHp === 0n ? 1 : 0;

    const speedBonus = combat.spd >= 200n ? 20 : Number(combat.spd / 10n);
    const evasionPenalty = slowed ? 25 : 0;

    const evasionChance = Math.max(
      0,
      Math.min(
        95,
        Number(combat.evade > 95n ? 95n : combat.evade) +
          speedBonus - evasionPenalty
      )
    );

    const evaded = newBossHp > 0n && newPlayerHp > 0n &&
      Math.random() * 100 < evasionChance;

    const minBossDamage = BigInt(Math.max(1, Number(bossData.minDamage) || 30000));
    const maxBossDamage = BigInt(Math.max(
      Number(minBossDamage),
      Number(bossData.maxDamage) || 100000
    ));
    const rawBossDamage = minBossDamage +
      BigInt(Math.floor(Math.random() *
        (Number(maxBossDamage - minBossDamage) + 1)));

    const bossDamage = newBossHp === 0n || evaded || newPlayerHp <= 0n
      ? 0n
      : (rawBossDamage > effectiveDef ? rawBossDamage - effectiveDef : 1n);

    newPlayerHp = newPlayerHp > bossDamage
      ? newPlayerHp - bossDamage
      : 0n;

    let bossSkill = null;
    const statusMessages = [];

    if (
      newBossHp > 0n &&
      newPlayerHp > 0n &&
      Array.isArray(bossData.skills) &&
      bossData.skills.length > 0 &&
      Math.random() < 0.25
    ) {
      const skill = bossData.skills[
        Math.floor(Math.random() * bossData.skills.length)
      ];
      bossSkill = {
        name: skill.name,
        description: skill.description,
        type: skill.type
      };

      const dotDamage = BigInt(Math.max(
        1,
        Math.floor((Number(bossData.minDamage) || 30000) / 10)
      ));

      switch (skill.type) {
        case "freeze":
          playerStatus.freezeTurns = Math.max(
            Number(playerStatus.freezeTurns || 0), 3
          );
          statusMessages.push("빙결: 다음 3턴 동안 공격할 수 없어.");
          break;

        case "burn":
        case "poison":
          playerStatus[`${skill.type}Turns`] = 3;
          playerStatus[`${skill.type}Damage`] = dotDamage.toString();
          statusMessages.push(
            `${skill.type === "burn" ? "화상" : "중독"}: 3턴 동안 지속 피해를 받아.`
          );
          break;

        case "weaken":
          playerStatus.weakenTurns = 3;
          statusMessages.push("약화: 3턴 동안 공격력이 감소해.");
          break;

        case "defenseDown":
          playerStatus.defenseDownTurns = 3;
          statusMessages.push("방어 약화: 3턴 동안 방어력이 감소해.");
          break;

        case "slow":
          playerStatus.slowTurns = 3;
          statusMessages.push("둔화: 3턴 동안 회피 능력이 감소해.");
          break;

        case "healBlock":
          playerStatus.healBlockTurns = 3;
          statusMessages.push("회복 봉쇄: 3턴 동안 체력을 회복할 수 없어.");
          break;

        case "shield":
          playerStatus.bossShieldTurns = 2;
          statusMessages.push("보호막: 다음 2턴 동안 보스가 받는 피해가 절반이 돼.");
          break;

        case "drain": {
          const extra = BigInt(Math.max(
            1,
            Math.floor((Number(bossData.minDamage) || 30000) / 2)
          ));
          newPlayerHp = newPlayerHp > extra ? newPlayerHp - extra : 0n;
          statusMessages.push(`추가 피해 ${extra.toString()}을 받았어.`);
          break;
        }

        case "bossHeal": {
          const recovery = bossMax / 100n > 0n ? bossMax / 100n : 1n;
          newBossHp = newBossHp + recovery > bossMax
            ? bossMax
            : newBossHp + recovery;
          statusMessages.push("보스가 최대 체력의 1%를 회복했어.");
          break;
        }

        case "confuse":
          playerStatus.confuseTurns = 3;
          statusMessages.push("혼란: 3턴 동안 공격력과 방어력이 감소해.");
          break;
      }
    }

    const healing = !healBlocked && newPlayerHp > 0n
      ? damage * combat.life / 100n + combat.regen
      : 0n;

    if (healing > 0n && newPlayerHp > 0n) {
      const maxHp = safeBigInt(state.max_hp);

      newPlayerHp = newPlayerHp + healing > maxHp
        ? maxHp
        : newPlayerHp + healing;
    }

    // 테스트 모드에서는 체력이 0이 되더라도 즉시 1조로 복구
    // 따라서 프런트엔드에서도 플레이어가 전투 불능 상태가 되지 않아
    if (BOSS_TEST_MODE && newPlayerHp <= 0n) {
      newPlayerHp = BOSS_TEST_HP;
    }

    const contributionResult = await client.query(
      `SELECT damage FROM boss_contributions
       WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3 FOR UPDATE`,
      [cycle, bossId, playerId]
    );

    const totalDamage =
      safeBigInt(contributionResult.rows[0]?.damage || "0") + damage;

    await client.query(
      `UPDATE world_bosses SET current_hp = $1, defeated = $2
       WHERE cycle_key = $3 AND boss_id = $4`,
      [newBossHp.toString(), defeated, cycle, bossId]
    );

    await client.query(
      `UPDATE boss_player_states
       SET current_hp = $1, max_hp = $2, status_json = $3
       WHERE cycle_key = $4 AND boss_id = $5 AND player_id = $6`,
      [
        newPlayerHp.toString(),
        BOSS_TEST_MODE ? BOSS_TEST_HP.toString() : state.max_hp,
        JSON.stringify(playerStatus),
        cycle,
        bossId,
        playerId
      ]
    );

    await client.query(
      `INSERT INTO boss_contributions
        (cycle_key, boss_id, player_id, damage)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cycle_key, boss_id, player_id)
       DO UPDATE SET damage = EXCLUDED.damage`,
      [cycle, bossId, playerId, totalDamage.toString()]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      damage: damage.toString(),
      currentHp: newBossHp.toString(),
      maxBossHp: bossMax.toString(),
      defeated: Boolean(defeated),
      critical,
      missed,
      playerHp: newPlayerHp.toString(),
      playerMaxHp: BOSS_TEST_MODE ? BOSS_TEST_HP.toString() : state.max_hp,
      bossDamage: bossDamage.toString(),
      evaded,
      statusDamage: statusDamage.toString(),
      bossSkill,
      statusMessages,
      statusEffects: playerStatus,
      healing: healing.toString(),
      contribution: totalDamage.toString(),
      combatStats: Object.fromEntries(
        Object.entries(combat).map(([key, value]) => [key, value.toString()])
      )
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("보스 공격 오류:", error);
    res.status(500).json({ error: "보스 공격 중 오류가 발생했어." });
  } finally {
    client.release();
  }
});

// 플레이어 등록 및 최신 분신 능력치 저장
app.post("/api/register", async (req, res) => {
  try {
    const { id, name, heroName, rank, power, stats } = req.body;

    if (!id || !name) {
      return res.status(400).json({ error: "정보가 부족해." });
    }

    const old = await getPlayer(id);
    const cleanStats = {};

    for (const key of ALLOWED_STATS) {
      const value = safeBigInt(
        stats?.[key] ?? old?.stats?.[key] ?? 0
      );
      cleanStats[key] = (value < 0n ? 0n : value).toString();
    }

    const player = {
      id: String(id),
      name: String(name).slice(0, 16),
      heroName: String(heroName || "").slice(0, 14),
      rank: Number(rank) || 15,
      power: String(power || "0"),
      wins: old ? old.wins : 0,
      stats: cleanStats
    };

    const result = await pool.query(
      `INSERT INTO players
        (id, name, "heroName", rank, power, wins, stats_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         "heroName" = EXCLUDED."heroName",
         rank = EXCLUDED.rank,
         power = EXCLUDED.power,
         stats_json = EXCLUDED.stats_json
       RETURNING id, name, "heroName", rank, power, wins, stats_json`,
      [
        player.id, player.name, player.heroName, player.rank,
        player.power, player.wins, JSON.stringify(cleanStats)
      ]
    );

    const saved = toPlayer(result.rows[0]);
    players.set(saved.id, saved);
    res.json({ success: true });
  } catch (error) {
    console.error("플레이어 등록 오류:", error);
    res.status(500).json({ error: "플레이어 정보를 저장하지 못했어." });
  }
});

// 랜덤 대전 대기
app.post("/api/queue", async (req, res) => {
  try {
    const id = String(req.body.id || "");
    const player = await getPlayer(id);

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
    const opponent = await getPlayer(opponentId);

    if (!opponent) {
      queue.push(id);
      return res.json({ success: true, matched: false });
    }

    const win = safeBigInt(player.power) >= safeBigInt(opponent.power);
    const winner = win ? player : opponent;
    winner.wins += 1;

    await pool.query(
      "UPDATE players SET wins = $1 WHERE id = $2",
      [winner.wins, winner.id]
    );

    players.set(winner.id, winner);

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
  } catch (error) {
    console.error("대전 대기 오류:", error);
    res.status(500).json({ error: "대전을 시작하지 못했어." });
  }
});

// 닉네임 대결
app.post("/api/challenge", async (req, res) => {
  try {
    const id = String(req.body.id || "");
    const targetName = String(req.body.targetName || "");
    const player = await getPlayer(id);

    const opponentResult = await pool.query(
      `SELECT id, name, "heroName", rank, power, wins, stats_json
       FROM players WHERE name = $1 AND id <> $2
       ORDER BY wins DESC LIMIT 1`,
      [targetName, id]
    );

    const opponent = toPlayer(opponentResult.rows[0]);

    if (!player || !opponent) {
      return res.status(404).json({
        error: "상대 플레이어를 찾을 수 없어."
      });
    }

    const win = safeBigInt(player.power) >= safeBigInt(opponent.power);
    const winner = win ? player : opponent;
    winner.wins += 1;

    await pool.query(
      "UPDATE players SET wins = $1 WHERE id = $2",
      [winner.wins, winner.id]
    );

    players.set(winner.id, winner);

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
  } catch (error) {
    console.error("닉네임 대결 오류:", error);
    res.status(500).json({ error: "대결을 진행하지 못했어." });
  }
});

// 대기 취소
app.post("/api/cancel", (req, res) => {
  const id = String(req.body.id || "");
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

// PvP 랭킹
app.get("/api/rankings", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, "heroName", rank, power, wins, stats_json
      FROM players
      ORDER BY wins DESC,
        CASE
          WHEN power ~ '^[0-9]+$' THEN power::numeric
          ELSE 0
        END DESC
      LIMIT 100
    `);

    res.json({
      players: result.rows.map(toPlayer)
    });
  } catch (error) {
    console.error("랭킹 조회 오류:", error);
    res.status(500).json({ error: "랭킹을 불러오지 못했어." });
  }
});

// 서버 상태 확인
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      success: true,
      message: "PostgreSQL 연결 정상"
    });
  } catch (error) {
    console.error("서버 상태 확인 오류:", error);
    res.status(500).json({
      success: false,
      message: "데이터베이스 연결 오류"
    });
  }
});

// 실시간 채팅
io.on("connection", socket => {
  console.log("사용자 접속:", socket.id);

  socket.on("chat message", message => {
    if (typeof message !== "string") return;

    const cleanMessage = message.trim().slice(0, 200);
    if (!cleanMessage) return;

    io.emit("chat message", {
      id: socket.id,
      message: cleanMessage,
      time: new Date().toISOString()
    });
  });

  socket.on("disconnect", () => {
    console.log("사용자 접속 종료:", socket.id);
  });
});

// 서버 실행
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initialiseDatabase();

    server.listen(PORT, () => {
      console.log(`분신 키우기 서버 실행 중! 포트: ${PORT}`);
    });
  } catch (error) {
    console.error("서버 시작 실패:", error);
    process.exit(1);
  }
}

startServer();
