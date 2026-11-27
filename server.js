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

// 기존 20종을 바탕으로 변형 보스를 추가해 총 120종을 구성한다.
const BOSS_VARIANTS = ["각성", "폭주", "심연", "종말", "태초"];
const WORLD_BOSS_NAMES = BOSS_NAMES.flatMap(name => [
  name,
  ...BOSS_VARIANTS.map(variant => `${variant}한 ${name}`)
]);

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

function bossConfig(bossId, bossName) {
  const baseName = BOSS_NAMES.find(name => bossName === name || bossName.endsWith(name));
  const base = BOSS_DATA[baseName] || BOSS_DATA[BOSS_NAMES[(Number(bossId) - 1) % BOSS_NAMES.length]] || {};
  const tier = BigInt(Math.max(1, Number(bossId) || 1));
  const recommendedPower = (10000n * tier).toString();
  const skills = (base.skills || [
    { name: "차원 붕괴", description: "차원의 힘으로 강력한 추가 피해와 약화를 부여한다!", type: "drain" },
    { name: "종말의 저주", description: "긴 시간 동안 막대한 지속 피해를 준다!", type: "poison" }
  ]).map(skill => ({ ...skill, description: `${skill.description} 효과가 대폭 강화되었다!` }));
  return { ...base, recommendedPower, minDamage: (BOSS_ATTACK_BASE * tier).toString(), maxDamage: (BOSS_ATTACK_BASE * tier * 2n).toString(), skills };
}

const ALLOWED_STATS = [
  "hp", "atk", "def", "spd", "crit", "critDmg",
  "acc", "evade", "pen", "life", "regen", "luck"
];

// 보스 체력은 공유 보스에게만 적용한다. 플레이어 체력은 분신의 실제 HP 능력치를 사용한다.
const WORLD_BOSS_HP = BigInt("100000000000000000000000000");
const BOSS_ATTACK_BASE = 1000n;

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

// 100,000종 재료 생성 규칙
const MATERIAL_PREFIX_A = [
  "태초", "고대", "찬란", "영원", "심연",
  "차원", "신성", "혼돈", "별빛", "은하"
];

const MATERIAL_PREFIX_B = [
  "붉은", "푸른", "검은", "하얀", "황금빛",
  "은빛", "수정빛", "불멸한", "성스러운", "저주받은"
];

const MATERIAL_CORE_A = [
  "불꽃", "서리", "번개", "바람", "대지",
  "바다", "달", "태양", "별", "그림자"
];

const MATERIAL_CORE_B = [
  "철", "구리", "은", "금", "수정",
  "마력", "정령", "용", "운석", "생명"
];

const MATERIAL_FORMS = [
  "조각", "파편", "가루", "결정", "핵",
  "정수", "씨앗", "룬", "인장", "보석"
];

const MATERIAL_TOTAL = 100000;
const MATERIAL_MAX_STAGE = 10000000;

function materialInfo(id) {
  id = Number(id);

  if (!Number.isInteger(id) || id < 1 || id > MATERIAL_TOTAL) {
    return null;
  }

  const n = id - 1;
  const prefixIndex = Math.floor(n / 1000);
  const coreIndex = Math.floor(n / 10) % 100;
  const formIndex = n % 10;

  const prefix =
    MATERIAL_PREFIX_A[Math.floor(prefixIndex / 10)] +
    "의 " +
    MATERIAL_PREFIX_B[prefixIndex % 10];

  const core =
    MATERIAL_CORE_A[Math.floor(coreIndex / 10)] +
    MATERIAL_CORE_B[coreIndex % 10];

  const startStage = 1 + Math.floor(n * 100);

  const endStage = Math.min(
    MATERIAL_MAX_STAGE,
    startStage + 100 + (n % 5) * 20
  );

  const price = 5 + Math.floor(
    Math.pow(startStage / 100 + 1, 1.12)
  );

  const rarity =
    startStage < 10000 ? "일반" :
    startStage < 100000 ? "고급" :
    startStage < 1000000 ? "희귀" :
    startStage < 5000000 ? "영웅" :
    "전설";

  return {
    id,
    name: `${prefix} ${core} ${MATERIAL_FORMS[formIndex]}`,
    startStage,
    endStage,
    price,
    rarity
  };
}

function createBossMaterialDrops(bossId) {
  const stage = Math.min(
    MATERIAL_MAX_STAGE,
    1000000 + Number(bossId) * 1000000
  );

  const center = Math.floor((stage - 1) / 100);
  const candidates = [];

  for (
    let n = Math.max(0, center - 10);
    n <= Math.min(MATERIAL_TOTAL - 1, center + 10);
    n++
  ) {
    const material = materialInfo(n + 1);

    if (
      material.endStage >= stage - 500 &&
      material.startStage <= stage + 500
    ) {
      candidates.push(material);
    }
  }

  const drops = [];

  for (let i = 0; i < 2 && candidates.length > 0; i++) {
    const index = Math.floor(Math.random() * candidates.length);
    const material = candidates.splice(index, 1)[0];

    drops.push({
      id: material.id,
      name: material.name,
      quantity: 3 + Math.floor(Math.random() * 8)
    });
  }

  return drops;
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

  await client.query(
    "INSERT INTO boss_cycles (cycle_key, created_at) VALUES ($1, $2) ON CONFLICT (cycle_key) DO NOTHING",
    [cycle, new Date().toISOString()]
  );

  // 예전에 일부 보스만 생성된 주기도 누락된 보스를 채워 넣는다.
  const existing = await client.query(
    "SELECT boss_id FROM world_bosses WHERE cycle_key = $1",
    [cycle]
  );
  const existingIds = new Set(existing.rows.map(row => Number(row.boss_id)));

  const shuffled = [...WORLD_BOSS_NAMES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (let bossId = 1; bossId <= 6; bossId++) {
    if (existingIds.has(bossId)) {
      await client.query(
        `UPDATE world_bosses SET max_hp = $1, current_hp = $1, defeated = 0
         WHERE cycle_key = $2 AND boss_id = $3 AND max_hp <> $1`,
        [WORLD_BOSS_HP.toString(), cycle, bossId]
      );
      continue;
    }
    const hp = WORLD_BOSS_HP.toString();
    await client.query(
      `INSERT INTO world_bosses
        (cycle_key, boss_id, name, max_hp, current_hp, defeated)
       VALUES ($1, $2, $3, $4, $4, 0)
       ON CONFLICT (cycle_key, boss_id) DO NOTHING`,
      [cycle, bossId, shuffled[bossId - 1], hp]
    );
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

    -- 보스 보상 중복 지급 방지
    CREATE TABLE IF NOT EXISTS boss_material_rewards (
      cycle_key TEXT NOT NULL,
      boss_id INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      reward_json JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (cycle_key, boss_id, player_id)
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

    -- 서버에 보관하는 거래용 게임 상태(골드/장비/재료)
    CREATE TABLE IF NOT EXISTS player_game_state (
      player_id TEXT PRIMARY KEY,
      money NUMERIC(40,0) NOT NULL DEFAULT 0,
      inventory_json JSONB NOT NULL DEFAULT '[]',
      materials_json JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trade_requests (
      id BIGSERIAL PRIMARY KEY,
      from_player TEXT NOT NULL,
      to_player TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trade_sessions (
      id BIGSERIAL PRIMARY KEY,
      player_a TEXT NOT NULL,
      player_b TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      offer_a JSONB NOT NULL DEFAULT '{"gold":"0","gear":[],"materials":[]}',
      offer_b JSONB NOT NULL DEFAULT '{"gold":"0","gear":[],"materials":[]}',
      confirmed_a BOOLEAN NOT NULL DEFAULT FALSE,
      confirmed_b BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS state_json JSONB NOT NULL DEFAULT '{}';

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

  // 20,000종 일일 퀘스트 템플릿을 최초 실행 시 생성한다.
  const questTypes = ["battle_win", "dungeon_win", "boss_attack", "craft", "material_sell", "pvp_win", "trade", "growth"];
  const questPrefixes = ["초보 모험가", "숙련 모험가", "용맹한 전사", "대지의 수호자", "별빛 추적자", "차원의 개척자", "전설의 도전자", "끝없는 탐험가"];
  const questRows = [];
  for (let qid = 1; qid <= 20000; qid++) {
    const typeIndex = (qid - 1) % questTypes.length;
    const tier = Math.floor((qid - 1) / questTypes.length) + 1;
    const target = 1 + ((tier - 1) % 20);
    const prefix = questPrefixes[Math.floor((qid - 1) / 2500) % questPrefixes.length];
    const labels = ["전투에서 승리하기", "던전 정복하기", "월드 보스 공격하기", "장비 제작하기", "재료 판매하기", "PvP 승리하기", "플레이어와 거래하기", "능력치 성장시키기"];
    const rewardGold = 100 + tier * 25 + target * 10;
    questRows.push([qid, `${prefix} ${labels[typeIndex]} ${tier}`, `${labels[typeIndex]} ${target}회`, questTypes[typeIndex], target, JSON.stringify({ gold: String(rewardGold), experience: String(target * 5) })]);
  }
  await pool.query(`INSERT INTO daily_quest_templates(quest_id,quest_name,description,quest_type,target_value,reward_json)
    SELECT x.quest_id,x.quest_name,x.description,x.quest_type,x.target_value,x.reward_json
    FROM UNNEST($1::int[],$2::text[],$3::text[],$4::text[],$5::bigint[],$6::text[]) AS x(quest_id,quest_name,description,quest_type,target_value,reward_json)
    ON CONFLICT (quest_id) DO NOTHING`, questRows.reduce((a,r,i)=>{a[i]=r;return a;},[]).length ? [questRows.map(r=>r[0]),questRows.map(r=>r[1]),questRows.map(r=>r[2]),questRows.map(r=>r[3]),questRows.map(r=>r[4]),questRows.map(r=>r[5])] : [[],[],[],[],[],[]]);

  await ensureBosses();

  console.log(
    `PostgreSQL 연결 완료: 플레이어 ${players.size}명 불러옴`
  );
}


function craftRecipeServer(recipeId) {
  const id = Number(recipeId);
  if (!Number.isInteger(id) || id < 1 || id > 225) return null;
  const slots = [
    ["weapon", "무기", "⚔️"], ["armor", "갑옷", "🛡️"],
    ["helmet", "투구", "⛑️"], ["gloves", "장갑", "🧤"], ["boots", "신발", "👢"]
  ];
  const gradeNames = ["초심","최하급","하급","일반","중급","상급","희귀","초희귀","불멸","유일","고대","영웅","전설","신화","초월"];
  const families = ["성운","태고","종언"];
  const zero=id-1, slotIndex=Math.floor(zero/45), gradeIndex=Math.floor((zero%45)/3), variant=zero%3;
  const slot=slots[slotIndex], grade=gradeIndex+1, quality=grade*grade;
  const base=Math.min(99990,Math.max(1,gradeIndex*6500+slotIndex*700+variant*170+1));
  const materials=[
    {id:base,quantity:2+Math.floor(grade/3)},
    {id:Math.min(100000,base+37+slotIndex*3),quantity:1+Math.floor(grade/4)},
    {id:Math.min(100000,base+91+variant*7),quantity:1+Math.floor(grade/5)}
  ];
  const statSets={
    weapon:["atk","critDmg","pen","crit"], armor:["def","hp","regen","life"],
    helmet:["hp","acc","luck","def"], gloves:["atk","spd","crit","acc"],
    boots:["spd","evade","luck","regen"]
  };
  const keys=statSets[slot[0]],bonus={};
  for(let j=0;j<keys.length;j++){
    if(j<3||((grade+variant+j)%3===0))bonus[keys[j]]=Math.max(1,quality*(j===0?12:j===1?7:4)*(variant+1));
  }
  return {
    recipeId:id,name:`${families[variant]} ${gradeNames[gradeIndex]} ${slot[1]}`,
    slot:slot[0],slotName:slot[1],icon:slot[2],grade,bonus,materials,
    craftOnly:true,source:"craft",price:Math.max(100,quality*10000*(variant+1))
  };
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
        recommendedPower: bossConfig(boss.boss_id, boss.name).recommendedPower,
        skills: bossConfig(boss.boss_id, boss.name).skills,
        defeated: Boolean(Number(boss.defeated))
      }))
    });
  } catch (error) {
    console.error("보스 조회 오류:", error);
    res.status(500).json({ error: "보스 정보를 불러오지 못했어." });
  }
});

// 저장된 재료 보관함 불러오기
app.get("/api/materials/:playerId", async (req, res) => {
  try {
    const playerId = String(req.params.playerId || "");
    const player = await getPlayer(playerId);

    if (!player) {
      return res.status(404).json({
        error: "플레이어를 찾을 수 없어."
      });
    }

    const result = await pool.query(
      `SELECT material_id, quantity
       FROM player_materials
       WHERE player_id = $1 AND quantity > 0`,
      [playerId]
    );

    const materials = {};

    for (const row of result.rows) {
      materials[row.material_id] = Number(row.quantity);
    }

    res.json({
      success: true,
      materials
    });
  } catch (error) {
    console.error("재료 불러오기 오류:", error);
    res.status(500).json({
      error: "재료를 불러오지 못했어."
    });
  }
});

// 로컬 재료 보관함을 서버에 동기화
app.post("/api/materials/sync", async (req, res) => {
  const client = await pool.connect();

  try {
    const playerId = String(req.body.id || "");
    const materials = req.body.materials;

    if (
      !playerId ||
      !materials ||
      typeof materials !== "object" ||
      Array.isArray(materials)
    ) {
      return res.status(400).json({
        error: "재료 정보가 올바르지 않아."
      });
    }

    if (Object.keys(materials).length > 2000) {
      return res.status(400).json({
        error: "재료 종류가 너무 많아."
      });
    }

    const player = await getPlayer(playerId);

    if (!player) {
      return res.status(404).json({
        error: "플레이어를 찾을 수 없어."
      });
    }

    await client.query("BEGIN");

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [playerId]
    );

    await client.query(
      "DELETE FROM player_materials WHERE player_id = $1",
      [playerId]
    );

    for (const [id, rawQuantity] of Object.entries(materials)) {
      const material = materialInfo(id);
      const quantity = Math.floor(Number(rawQuantity));

      if (
        !material ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        continue;
      }

      await client.query(
        `INSERT INTO player_materials
          (player_id, material_id, material_name, quantity)
         VALUES ($1, $2, $3, $4)`,
        [
          playerId,
          String(material.id),
          material.name,
          quantity
        ]
      );
    }

    await client.query("COMMIT");

    res.json({ success: true });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("재료 동기화 오류:", error);

    res.status(500).json({
      error: "재료를 저장하지 못했어."
    });
  } finally {
    client.release();
  }
});


// 제작 전용 장비: 제작식·재료 차감·장비 지급을 DB 트랜잭션 안에서 검증한다.
app.post("/api/craft", async (req, res) => {
  const client = await pool.connect();
  try {
    const playerId = String(req.body.id || "");
    const recipe = craftRecipeServer(req.body.recipeId);
    if (!playerId || !recipe) return res.status(400).json({ error: "제작 정보가 올바르지 않아." });
    if (!(await getPlayer(playerId))) return res.status(404).json({ error: "플레이어를 찾을 수 없어." });
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [playerId]);
    const stateResult = await client.query(
      "SELECT inventory_json FROM player_game_state WHERE player_id=$1 FOR UPDATE", [playerId]
    );
    const inventory = stateResult.rows.length && Array.isArray(stateResult.rows[0].inventory_json)
      ? stateResult.rows[0].inventory_json : [];
    if (inventory.length >= 2000) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "인벤토리가 가득 찼어. 장비를 정리한 뒤 다시 제작해 줘." });
    }
    for (const need of recipe.materials) {
      const found = await client.query(
        "SELECT quantity FROM player_materials WHERE player_id=$1 AND material_id=$2 FOR UPDATE",
        [playerId, String(need.id)]
      );
      const have = found.rows.length ? Number(found.rows[0].quantity) : 0;
      if (!Number.isSafeInteger(have) || have < need.quantity) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `재료 #${need.id}가 부족해. 필요 수량은 ${need.quantity}개야.` });
      }
    }
    for (const need of recipe.materials) {
      await client.query(
        "UPDATE player_materials SET quantity=quantity-$1 WHERE player_id=$2 AND material_id=$3",
        [need.quantity, playerId, String(need.id)]
      );
    }
    await client.query("DELETE FROM player_materials WHERE player_id=$1 AND quantity<=0", [playerId]);
    const item = {
      ...recipe,
      uid: `craft-${playerId}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`
    };
    inventory.push(item);
    await client.query(
      `INSERT INTO player_game_state(player_id,money,inventory_json,materials_json)
       VALUES($1,0,$2::jsonb,'[]'::jsonb)
       ON CONFLICT(player_id) DO UPDATE SET inventory_json=EXCLUDED.inventory_json,updated_at=NOW()`,
      [playerId, JSON.stringify(inventory)]
    );
    await client.query("COMMIT");
    res.json({ success: true, item });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("장비 제작 오류:", error);
    res.status(500).json({ error: "장비 제작 중 서버 오류가 발생했어." });
  } finally { client.release(); }
});

app.post("/api/bosses/:bossId/join", async (req, res) => {
  try {
    const playerId = String(req.body.id || "");
    const bossId = Number(req.params.bossId);
    const player = await getPlayer(playerId);

    if (!player) {
      return res.status(404).json({
        error: "먼저 온라인 서버에 접속해 줘."
      });
    }

    if (!Number.isInteger(bossId) || bossId < 1 || bossId > 6) {
      return res.status(400).json({
        error: "잘못된 보스 번호야."
      });
    }

    const cycle = await ensureBosses();

    const bossResult = await pool.query(
      `SELECT * FROM world_bosses
       WHERE cycle_key = $1 AND boss_id = $2`,
      [cycle, bossId]
    );

    const boss = bossResult.rows[0];

    if (!boss || Number(boss.defeated) === 1) {
      return res.status(400).json({
        error: "전투할 수 없는 보스야."
      });
    }

    // 플레이어 최대 체력은 보스 설정과 무관하게 분신의 실제 HP 능력치다.
    const playerStatHp = safeBigInt(player.stats?.hp || "0");
    const maxHpValue = playerStatHp > 0n ? playerStatHp : 1n;
    const maxHp = maxHpValue.toString();

    let stateResult = await pool.query(
      `SELECT current_hp, max_hp, status_json FROM boss_player_states
       WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3`,
      [cycle, bossId, playerId]
    );

    let state = stateResult.rows[0];

    if (!state) {
      await pool.query(
        `INSERT INTO boss_player_states
          (cycle_key, boss_id, player_id, current_hp, max_hp, status_json)
         VALUES ($1, $2, $3, $4, $4, '{}')
         ON CONFLICT (cycle_key, boss_id, player_id) DO NOTHING`,
        [cycle, bossId, playerId, maxHp]
      );
      stateResult = await pool.query(
        `SELECT current_hp, max_hp, status_json FROM boss_player_states
         WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3`,
        [cycle, bossId, playerId]
      );
      state = stateResult.rows[0];
    } else if (safeBigInt(state.max_hp) !== maxHpValue) {
      // 예전 테스트 모드에서 저장된 비정상적으로 큰 체력을 실제 능력치로 교정한다.
      await pool.query(
        `UPDATE boss_player_states
         SET current_hp = $1, max_hp = $2, status_json = '{}'
         WHERE cycle_key = $3 AND boss_id = $4 AND player_id = $5`,
        [maxHp, maxHp, cycle, bossId, playerId]
      );
      state = { current_hp: maxHp, max_hp: maxHp, status_json: {} };
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
        recommendedPower: bossConfig(boss.boss_id, boss.name).recommendedPower,
        skills: bossConfig(boss.boss_id, boss.name).skills,
        defeated: Boolean(Number(boss.defeated))
      },
      currentHp: state.current_hp,
      maxHp: state.max_hp,
      contribution: contributionResult.rows[0]?.damage || "0"
    });
  } catch (error) {
    console.error("보스전 입장 오류:", error);

    res.status(500).json({
      error: "보스전 입장에 실패했어."
    });
  }
});

// 보스 공격
app.post("/api/bosses/:bossId/attack", async (req, res) => {
  const client = await pool.connect();

  try {
    const playerId = String(req.body.id || "");
    const bossId = Number(req.params.bossId);

    if (!Number.isInteger(bossId) || bossId < 1 || bossId > 6) {
      return res.status(400).json({
        error: "잘못된 보스 번호야."
      });
    }

    const player = await getPlayer(playerId);

    if (!player) {
      return res.status(404).json({
        error: "플레이어를 찾을 수 없어."
      });
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

      return res.status(404).json({
        error: "보스를 찾을 수 없어."
      });
    }

    if (Number(boss.defeated) === 1) {
      await client.query("ROLLBACK");

      return res.json({
        success: false,
        message: "이미 쓰러진 보스야."
      });
    }

    const stateResult = await client.query(
      `SELECT current_hp, max_hp, status_json FROM boss_player_states
       WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3 FOR UPDATE`,
      [cycle, bossId, playerId]
    );

    const state = stateResult.rows[0];

    if (!state) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "먼저 보스전에 입장해 줘."
      });
    }

    // 과거 테스트 모드에서 저장된 플레이어 체력을 실제 HP 능력치로 복구한다.
    const actualPlayerMaxHp = safeBigInt(player.stats?.hp || "0") > 0n
      ? safeBigInt(player.stats.hp)
      : 1n;
    if (safeBigInt(state.max_hp) !== actualPlayerMaxHp) {
      await client.query(
        `UPDATE boss_player_states
         SET current_hp = $1, max_hp = $2, status_json = '{}'
         WHERE cycle_key = $3 AND boss_id = $4 AND player_id = $5`,
        [actualPlayerMaxHp.toString(), actualPlayerMaxHp.toString(), cycle, bossId, playerId]
      );
      state.current_hp = actualPlayerMaxHp.toString();
      state.max_hp = actualPlayerMaxHp.toString();
      state.status_json = {};
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
      const value = base(key) +
        BigInt(Math.floor(Math.random() * 61) - 30);

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

    const bossData = bossConfig(bossId, boss.name);

    const bossMax = safeBigInt(boss.max_hp);
    const oldBossHp = safeBigInt(boss.current_hp);
    const oldPlayerHp = safeBigInt(state.current_hp);
    const bossDefense = 10n;

    const luckBonus = combat.luck >= 1000n
      ? 10
      : Number(combat.luck / 100n);

    let statusDamage = 0n;

    for (const effect of ["burn", "poison"]) {
      const turnsKey = `${effect}Turns`;
      const damageKey = `${effect}Damage`;
      const turns = Math.max(
        0,
        Number(playerStatus[turnsKey] || 0)
      );

      if (turns > 0) {
        statusDamage += safeBigInt(
          playerStatus[damageKey] || 0
        );

        playerStatus[turnsKey] = turns - 1;

        if (playerStatus[turnsKey] === 0) {
          delete playerStatus[damageKey];
        }
      }
    }

    let newPlayerHp = oldPlayerHp > statusDamage
      ? oldPlayerHp - statusDamage
      : 0n;

    const frozen = Number(playerStatus.freezeTurns || 0) > 0;
    if (frozen) playerStatus.freezeTurns--;

    const weakened = Number(playerStatus.weakenTurns || 0) > 0;
    if (weakened) playerStatus.weakenTurns--;

    const defenseReduced =
      Number(playerStatus.defenseDownTurns || 0) > 0;

    if (defenseReduced) playerStatus.defenseDownTurns--;

    const slowed = Number(playerStatus.slowTurns || 0) > 0;
    if (slowed) playerStatus.slowTurns--;

    const confused = Number(playerStatus.confuseTurns || 0) > 0;
    if (confused) playerStatus.confuseTurns--;

    const healBlocked =
      Number(playerStatus.healBlockTurns || 0) > 0;

    if (healBlocked) playerStatus.healBlockTurns--;

    const bossShielded =
      Number(playerStatus.bossShieldTurns || 0) > 0;

    if (bossShielded) playerStatus.bossShieldTurns--;

    const effectiveAtk = combat.atk *
      BigInt(confused ? 50 : weakened ? 70 : 100) / 100n;

    const effectiveDef = combat.def *
      BigInt(confused ? 50 : defenseReduced ? 50 : 100) / 100n;

    const hitChance = Math.max(
      1,
      Math.min(
        99,
        Number(combat.acc > 99n ? 99n : combat.acc) + luckBonus
      )
    );

    const missed = frozen ||
      newPlayerHp <= 0n ||
      Math.random() * 100 >= hitChance;

    const critical = !missed &&
      Math.random() * 100 <
      Math.max(
        0,
        Math.min(
          95,
          Number(combat.crit > 95n ? 95n : combat.crit)
        )
      );

    let damage = 0n;

    if (!missed) {
      damage = effectiveAtk +
        (
          critical
            ? effectiveAtk * combat.critDmg / 100n
            : 0n
        );

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

    const speedBonus = combat.spd >= 200n
      ? 20
      : Number(combat.spd / 10n);

    const evasionPenalty = slowed ? 25 : 0;

    const evasionChance = Math.max(
      0,
      Math.min(
        95,
        Number(combat.evade > 95n ? 95n : combat.evade) +
          speedBonus -
          evasionPenalty
      )
    );

    const minBossDamage = safeBigInt(bossData.minDamage, BOSS_ATTACK_BASE);
    const maxBossDamage = safeBigInt(bossData.maxDamage, minBossDamage * 2n);
    const damageRange = maxBossDamage - minBossDamage;
    const rawBossDamage = minBossDamage +
      (damageRange > 0n
        ? BigInt(Math.floor(Math.random() * 1000000)) * damageRange / 1000000n
        : 0n);

    const evaded = newBossHp > 0n &&
      newPlayerHp > 0n &&
      Math.random() * 100 < evasionChance;

    const bossDamage =
      newBossHp === 0n || evaded || newPlayerHp <= 0n
        ? 0n
        : (
          rawBossDamage > effectiveDef
            ? rawBossDamage - effectiveDef
            : 1n
        );

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
      Math.random() < 0.65
    ) {
      const skill = bossData.skills[
        Math.floor(Math.random() * bossData.skills.length)
      ];

      bossSkill = {
        name: skill.name,
        description: skill.description,
        type: skill.type
      };

      const dotDamage = minBossDamage / 5n > 0n ? minBossDamage / 5n : 1n;

      switch (skill.type) {
        case "freeze":
          playerStatus.freezeTurns = Math.max(
            Number(playerStatus.freezeTurns || 0),
            5
          );

          statusMessages.push(
            "강화 빙결: 다음 5턴 동안 공격할 수 없어."
          );
          break;

        case "burn":
        case "poison":
          playerStatus[`${skill.type}Turns`] = 5;
          playerStatus[`${skill.type}Damage`] =
            dotDamage.toString();

          statusMessages.push(
            `${skill.type === "burn" ? "화상" : "중독"}: 5턴 동안 막대한 지속 피해를 받아.`
          );
          break;

        case "weaken":
          playerStatus.weakenTurns = 5;
          statusMessages.push(
            "강화 약화: 5턴 동안 공격력이 크게 감소해."
          );
          break;

        case "defenseDown":
          playerStatus.defenseDownTurns = 5;
          statusMessages.push(
            "강화 방어 약화: 5턴 동안 방어력이 크게 감소해."
          );
          break;

        case "slow":
          playerStatus.slowTurns = 5;
          statusMessages.push(
            "강화 둔화: 5턴 동안 회피 능력이 크게 감소해."
          );
          break;

        case "healBlock":
          playerStatus.healBlockTurns = 5;
          statusMessages.push(
            "강화 회복 봉쇄: 5턴 동안 체력을 회복할 수 없어."
          );
          break;

        case "shield":
          playerStatus.bossShieldTurns = 3;
          statusMessages.push(
            "강화 보호막: 다음 3턴 동안 보스가 받는 피해가 절반이 돼."
          );
          break;

        case "drain": {
          const extra = minBossDamage / 2n > 0n ? minBossDamage / 2n : 1n;

          newPlayerHp = newPlayerHp > extra
            ? newPlayerHp - extra
            : 0n;

          statusMessages.push(
            `추가 피해 ${extra.toString()}을 받았어.`
          );
          break;
        }

        case "bossHeal": {
          const recovery = bossMax / 10n > 0n
            ? bossMax / 10n
            : 1n;

          newBossHp = newBossHp + recovery > bossMax
            ? bossMax
            : newBossHp + recovery;

          statusMessages.push(
            "보스가 최대 체력의 10%를 회복했어."
          );
          break;
        }

        case "confuse":
          playerStatus.confuseTurns = 5;
          statusMessages.push(
            "강화 혼란: 5턴 동안 공격력과 방어력이 크게 감소해."
          );
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

    let myMaterialDrops = [];

    const contributionResult = await client.query(
      `SELECT damage FROM boss_contributions
       WHERE cycle_key = $1 AND boss_id = $2 AND player_id = $3 FOR UPDATE`,
      [cycle, bossId, playerId]
    );

    const totalDamage =
      safeBigInt(contributionResult.rows[0]?.damage || "0") +
      damage;

    await client.query(
      `UPDATE world_bosses SET current_hp = $1, defeated = $2
       WHERE cycle_key = $3 AND boss_id = $4`,
      [
        newBossHp.toString(),
        defeated,
        cycle,
        bossId
      ]
    );

    await client.query(
      `UPDATE boss_player_states
       SET current_hp = $1, max_hp = $2, status_json = $3
       WHERE cycle_key = $4 AND boss_id = $5 AND player_id = $6`,
      [
        newPlayerHp.toString(),
        state.max_hp,
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
      [
        cycle,
        bossId,
        playerId,
        totalDamage.toString()
      ]
    );

    // 보스 처치 시 이번 주기 참여자 전원에게 보상 지급
    if (defeated) {
      const contributors = await client.query(
        `SELECT player_id
         FROM boss_contributions
         WHERE cycle_key = $1
           AND boss_id = $2
           AND damage::numeric > 0`,
        [cycle, bossId]
      );

      for (const contributor of contributors.rows) {
        const rewardPlayerId = contributor.player_id;
        const drops = createBossMaterialDrops(bossId);

        // 같은 보스·주기·플레이어에게는 보상 기록을 한 번만 생성
        const rewardInsert = await client.query(
          `INSERT INTO boss_material_rewards
            (cycle_key, boss_id, player_id, reward_json)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (cycle_key, boss_id, player_id)
           DO NOTHING
           RETURNING player_id`,
          [
            cycle,
            bossId,
            rewardPlayerId,
            JSON.stringify(drops)
          ]
        );

        if (rewardInsert.rowCount === 0) {
          continue;
        }

        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1))",
          [rewardPlayerId]
        );

        for (const drop of drops) {
          await client.query(
            `INSERT INTO player_materials
              (player_id, material_id, material_name, quantity)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (player_id, material_id)
             DO UPDATE SET
               quantity = player_materials.quantity + EXCLUDED.quantity,
               material_name = EXCLUDED.material_name`,
            [
              rewardPlayerId,
              String(drop.id),
              drop.name,
              drop.quantity
            ]
          );
        }

        if (rewardPlayerId === playerId) {
          myMaterialDrops = drops;
        }
      }
    }

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
      playerMaxHp: state.max_hp,
      bossDamage: bossDamage.toString(),
      evaded,
      statusDamage: statusDamage.toString(),
      bossSkill,
      statusMessages,
      statusEffects: playerStatus,
      healing: healing.toString(),
      contribution: totalDamage.toString(),
      materialDrops: myMaterialDrops,
      combatStats: Object.fromEntries(
        Object.entries(combat).map(([key, value]) => [
          key,
          value.toString()
        ])
      )
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("보스 공격 오류:", error);

    res.status(500).json({
      error: "보스 공격 중 오류가 발생했어."
    });
  } finally {
    client.release();
  }
});

// 플레이어 등록 및 최신 분신 능력치 저장
app.post("/api/register", async (req, res) => {
  try {
    const {
      id,
      name,
      heroName,
      rank,
      power,
      stats
    } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        error: "정보가 부족해."
      });
    }

    const old = await getPlayer(id);
    const cleanStats = {};

    for (const key of ALLOWED_STATS) {
      const value = safeBigInt(
        stats?.[key] ?? old?.stats?.[key] ?? 0
      );

      cleanStats[key] = (
        value < 0n ? 0n : value
      ).toString();
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
        player.id,
        player.name,
        player.heroName,
        player.rank,
        player.power,
        player.wins,
        JSON.stringify(cleanStats)
      ]
    );

    const saved = toPlayer(result.rows[0]);
    players.set(saved.id, saved);

    res.json({ success: true });
  } catch (error) {
    console.error("플레이어 등록 오류:", error);

    res.status(500).json({
      error: "플레이어 정보를 저장하지 못했어."
    });
  }
});

// 랜덤 대전 대기
app.post("/api/queue", async (req, res) => {
  try {
    const id = String(req.body.id || "");
    const player = await getPlayer(id);

    if (!player) {
      return res.status(404).json({
        error: "먼저 서버에 접속해 줘."
      });
    }

    if (queue.includes(id)) {
      return res.json({
        success: true,
        matched: false
      });
    }

    const index = queue.findIndex(x => x !== id);

    if (index === -1) {
      queue.push(id);

      return res.json({
        success: true,
        matched: false
      });
    }

    const opponentId = queue.splice(index, 1)[0];
    const opponent = await getPlayer(opponentId);

    if (!opponent) {
      queue.push(id);

      return res.json({
        success: true,
        matched: false
      });
    }

    const win =
      safeBigInt(player.power) >= safeBigInt(opponent.power);

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

    res.json({
      success: true,
      matched: true
    });
  } catch (error) {
    console.error("대전 대기 오류:", error);

    res.status(500).json({
      error: "대전을 시작하지 못했어."
    });
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
       FROM players
       WHERE name = $1 AND id <> $2
       ORDER BY wins DESC
       LIMIT 1`,
      [targetName, id]
    );

    const opponent = toPlayer(opponentResult.rows[0]);

    if (!player || !opponent) {
      return res.status(404).json({
        error: "상대 플레이어를 찾을 수 없어."
      });
    }

    const win =
      safeBigInt(player.power) >= safeBigInt(opponent.power);

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

    res.json({
      success: true,
      opponent
    });
  } catch (error) {
    console.error("닉네임 대결 오류:", error);

    res.status(500).json({
      error: "대결을 진행하지 못했어."
    });
  }
});

// 대기 취소
app.post("/api/cancel", (req, res) => {
  const id = String(req.body.id || "");
  const index = queue.indexOf(id);

  if (index !== -1) {
    queue.splice(index, 1);
  }

  res.json({ success: true });
});

// 대전 결과
app.get("/api/match/:id", (req, res) => {
  const match = matches.get(req.params.id);

  if (!match) {
    return res.json({ match: null });
  }

  matches.delete(req.params.id);
  res.json({ match });
});

// 게임 자산을 거래 서버에 동기화한다.
app.post("/api/game-state/sync", async (req, res) => {
  const client = await pool.connect();
  try {
    const id = String(req.body.id || "");
    const money = String(req.body.money ?? "0");
    const inventory = req.body.inventory;
    const materials = req.body.materials;
    if (!id || !/^\d{1,40}$/.test(money) || !Array.isArray(inventory) || !Array.isArray(materials)) {
      return res.status(400).json({ error: "게임 저장 정보가 올바르지 않아." });
    }
    if (inventory.length > 2000 || materials.length > 2000) {
      return res.status(400).json({ error: "인벤토리 한도는 2,000칸이야." });
    }
    if (!(await getPlayer(id))) return res.status(404).json({ error: "플레이어를 찾을 수 없어." });
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
    await client.query(`INSERT INTO player_game_state(player_id,money,inventory_json,materials_json)
      VALUES($1,$2,$3::jsonb,$4::jsonb)
      ON CONFLICT(player_id) DO UPDATE SET money=EXCLUDED.money,inventory_json=EXCLUDED.inventory_json,
      materials_json=EXCLUDED.materials_json,updated_at=NOW()`,
      [id, money, JSON.stringify(inventory), JSON.stringify(materials)]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("게임 상태 동기화 오류:", error);
    res.status(500).json({ error: "게임 상태를 저장하지 못했어." });
  } finally { client.release(); }
});

app.get("/api/game-state/:playerId", async (req, res) => {
  try {
    const id = String(req.params.playerId || "");
    const result = await pool.query("SELECT money,inventory_json,materials_json FROM player_game_state WHERE player_id=$1", [id]);
    if (!result.rows.length) return res.json({ success: true, state: null });
    const row = result.rows[0];
    res.json({ success: true, state: { money: String(row.money), inventory: row.inventory_json || [], materials: row.materials_json || [] } });
  } catch (error) { console.error(error); res.status(500).json({ error: "게임 상태를 불러오지 못했어." }); }
});

// 거래 요청: 고유 플레이어 번호로만 상대를 지정한다.
app.post("/api/trade/request", async (req, res) => {
  try {
    const fromId = String(req.body.fromId || ""), toId = String(req.body.toId || "");
    if (!fromId || !toId || fromId === toId) return res.status(400).json({ error: "상대 고유 번호를 확인해 줘." });
    if (!(await getPlayer(fromId)) || !(await getPlayer(toId))) return res.status(404).json({ error: "상대 또는 내 플레이어를 찾을 수 없어." });
    const pending = await pool.query(`SELECT id FROM trade_requests WHERE from_player=$1 AND to_player=$2 AND status='pending'`, [fromId,toId]);
    if (pending.rows.length) return res.status(409).json({ error: "이미 거래 요청을 보냈어." });
    const r = await pool.query(`INSERT INTO trade_requests(from_player,to_player) VALUES($1,$2) RETURNING id`, [fromId,toId]);
    res.json({ success: true, requestId: String(r.rows[0].id) });
  } catch (error) { console.error(error); res.status(500).json({ error: "거래 요청을 보내지 못했어." }); }
});

app.get("/api/trade/inbox/:playerId", async (req, res) => {
  try {
    const id = String(req.params.playerId || "");
    const requests = await pool.query(`SELECT r.id,r.from_player,p.name FROM trade_requests r LEFT JOIN players p ON p.id=r.from_player WHERE r.to_player=$1 AND r.status='pending' ORDER BY r.created_at DESC`, [id]);
    const sessions = await pool.query(`SELECT id,player_a,player_b,status,offer_a,offer_b,confirmed_a,confirmed_b FROM trade_sessions WHERE (player_a=$1 OR player_b=$1) AND status='active' ORDER BY updated_at DESC`, [id]);
    res.json({ success: true, requests: requests.rows, sessions: sessions.rows.map(x=>({ ...x, id:String(x.id) })) });
  } catch (error) { console.error(error); res.status(500).json({ error: "거래 목록을 불러오지 못했어." }); }
});

app.post("/api/trade/request/:requestId/respond", async (req, res) => {
  const client = await pool.connect();
  try {
    const id = String(req.body.playerId || ""), accept = Boolean(req.body.accept);
    await client.query("BEGIN");
    const q = await client.query("SELECT * FROM trade_requests WHERE id=$1 FOR UPDATE", [req.params.requestId]);
    if (!q.rows.length || q.rows[0].to_player !== id || q.rows[0].status !== "pending") { await client.query("ROLLBACK"); return res.status(404).json({ error: "유효한 거래 요청이 아니야." }); }
    const request = q.rows[0];
    if (!accept) {
      await client.query("UPDATE trade_requests SET status='rejected' WHERE id=$1", [request.id]);
      await client.query("COMMIT"); return res.json({ success: true, rejected: true });
    }
    await client.query("UPDATE trade_requests SET status='accepted' WHERE id=$1", [request.id]);
    const session = await client.query("INSERT INTO trade_sessions(player_a,player_b) VALUES($1,$2) RETURNING id", [request.from_player,request.to_player]);
    await client.query("COMMIT");
    res.json({ success: true, sessionId: String(session.rows[0].id) });
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} console.error(error); res.status(500).json({ error: "거래 요청을 처리하지 못했어." }); }
  finally { client.release(); }
});

app.get("/api/trade/session/:sessionId", async (req, res) => {
  try {
    const playerId = String(req.query.playerId || "");
    const q = await pool.query(`SELECT * FROM trade_sessions WHERE id=$1 AND (player_a=$2 OR player_b=$2)`, [req.params.sessionId,playerId]);
    if (!q.rows.length) return res.status(404).json({ error: "거래방을 찾을 수 없어." });
    const t=q.rows[0];
    res.json({ success:true, session:{ id:String(t.id), playerA:t.player_a, playerB:t.player_b, status:t.status, myOffer:t.player_a===playerId?t.offer_a:t.offer_b, otherOffer:t.player_a===playerId?t.offer_b:t.offer_a, myConfirmed:t.player_a===playerId?t.confirmed_a:t.confirmed_b, otherConfirmed:t.player_a===playerId?t.confirmed_b:t.confirmed_a } });
  } catch(error){ console.error(error); res.status(500).json({error:"거래방 정보를 불러오지 못했어."}); }
});

app.post("/api/trade/session/:sessionId/offer", async (req,res)=>{
  try{
    const playerId=String(req.body.playerId||""), offer=req.body.offer||{};
    const gold=String(offer.gold??"0"), gear=Array.isArray(offer.gear)?offer.gear:[], materials=Array.isArray(offer.materials)?offer.materials:[];
    if(!/^\d{1,40}$/.test(gold)||gear.length>2000||materials.length>2000) return res.status(400).json({error:"거래 제안이 올바르지 않아."});
    const q=await pool.query("SELECT * FROM trade_sessions WHERE id=$1 AND status='active' AND (player_a=$2 OR player_b=$2)",[req.params.sessionId,playerId]);
    if(!q.rows.length)return res.status(404).json({error:"진행 중인 거래가 아니야."});
    const t=q.rows[0], side=t.player_a===playerId?'a':'b';
    const acceptGear=Array.isArray(offer.acceptGear)?offer.acceptGear.map(String):undefined;
    const acceptMaterials=Array.isArray(offer.acceptMaterials)?offer.acceptMaterials:undefined;
    const clean={gold,gear,materials,acceptGear,acceptMaterials};
    await pool.query(`UPDATE trade_sessions SET offer_${side}=$1::jsonb,confirmed_a=FALSE,confirmed_b=FALSE,updated_at=NOW() WHERE id=$2`,[JSON.stringify(clean),t.id]);
    res.json({success:true});
  }catch(error){console.error(error);res.status(500).json({error:"거래 제안을 저장하지 못했어."});}
});

app.post("/api/trade/session/:sessionId/confirm", async (req,res)=>{
  const client=await pool.connect();
  try{
    const playerId=String(req.body.playerId||"");
    await client.query("BEGIN");
    const q=await client.query("SELECT * FROM trade_sessions WHERE id=$1 AND status='active' AND (player_a=$2 OR player_b=$2) FOR UPDATE",[req.params.sessionId,playerId]);
    if(!q.rows.length){await client.query("ROLLBACK");return res.status(404).json({error:"진행 중인 거래가 아니야."});}
    const t=q.rows[0], side=t.player_a===playerId?'a':'b';
    await client.query(`UPDATE trade_sessions SET confirmed_${side}=TRUE,updated_at=NOW() WHERE id=$1`,[t.id]);
    const fresh=(await client.query("SELECT * FROM trade_sessions WHERE id=$1",[t.id])).rows[0];
    if(!(fresh.confirmed_a&&fresh.confirmed_b)){await client.query("COMMIT");return res.json({success:true,completed:false});}
    // 양쪽이 확정한 시점에 서버의 자산 스냅샷을 잠그고 검증한다.
    const states=await client.query("SELECT * FROM player_game_state WHERE player_id=ANY($1::text[]) FOR UPDATE",[[t.player_a,t.player_b]]);
    if(states.rows.length!==2){await client.query("ROLLBACK");return res.status(409).json({error:"양쪽 모두 게임 상태를 서버에 저장한 뒤 거래해야 해."});}
    const byId=Object.fromEntries(states.rows.map(r=>[r.player_id,{money:BigInt(String(r.money)),inventory:r.inventory_json||[],materials:r.materials_json||[]}]));
    const a=byId[t.player_a],b=byId[t.player_b],oa=fresh.offer_a||{},ob=fresh.offer_b||{};
    const removeOffer=(state,offer)=>{
      const removed={gear:[],materials:[]};
      const gold=BigInt(String(offer.gold||0)); if(gold>state.money)throw Error("제안한 골드가 부족해."); state.money-=gold;
      for(const item of (offer.gear||[])){const i=state.inventory.findIndex(x=>String(x.uid)===String(item.uid));if(i<0)throw Error("제안한 장비를 찾을 수 없어.");removed.gear.push(state.inventory.splice(i,1)[0]);}
      for(const m of (offer.materials||[])){const i=state.materials.findIndex(x=>String(x.id)===String(m.id));const qty=Math.floor(Number(m.quantity)||0);if(i<0||qty<1||Number(state.materials[i].quantity)<qty)throw Error("제안한 재료 수량이 부족해.");const info={...state.materials[i],quantity:qty};state.materials[i].quantity-=qty;if(state.materials[i].quantity<=0)state.materials.splice(i,1);removed.materials.push(info);}
      return removed;
    };
    const removedA=removeOffer(a,oa), removedB=removeOffer(b,ob);
    const addMaterial=(state,m,qty)=>{if(qty<=0)return;const i=state.materials.findIndex(x=>String(x.id)===String(m.id));if(i<0)state.materials.push({...m,quantity:qty});else state.materials[i].quantity=Number(state.materials[i].quantity)+qty;};
    const addOffer=(recipient,offer,prefs,sender,removed)=>{
      recipient.money+=BigInt(String(offer.gold||0));
      const gearPrefs=Array.isArray(prefs.acceptGear)?new Set(prefs.acceptGear.map(String)):null;
      for(const item of removed.gear){if(!gearPrefs||gearPrefs.has(String(item.uid)))recipient.inventory.push(item);else sender.inventory.push(item);}
      for(const m of removed.materials){const hasPrefs=Array.isArray(prefs.acceptMaterials);const pref=hasPrefs?prefs.acceptMaterials.find(x=>String(x.id)===String(m.id)):null;const wanted=hasPrefs?(pref?Math.max(0,Math.min(Number(m.quantity),Math.floor(Number(pref.quantity)||0))):0):Number(m.quantity);addMaterial(recipient,m,wanted);addMaterial(sender,m,Number(m.quantity)-wanted);}
      if(recipient.inventory.length+recipient.materials.length>2000)throw Error("인벤토리가 가득 찼어. 받을 물건 선택을 줄여 줘.");
      if(sender.inventory.length+sender.materials.length>2000)throw Error("돌려받을 물건을 보관할 인벤토리 공간이 부족해.");
    };
    addOffer(a,ob,oa,b,removedB); addOffer(b,oa,ob,a,removedA);
    for(const [id,state] of [[t.player_a,a],[t.player_b,b]]) await client.query(`UPDATE player_game_state SET money=$1,inventory_json=$2::jsonb,materials_json=$3::jsonb,updated_at=NOW() WHERE player_id=$4`,[state.money.toString(),JSON.stringify(state.inventory),JSON.stringify(state.materials),id]);
    await client.query("UPDATE trade_sessions SET status='completed' WHERE id=$1",[t.id]);
    await client.query("COMMIT");
    res.json({success:true,completed:true});
  }catch(error){try{await client.query("ROLLBACK");}catch{}console.error("거래 확정 오류:",error);res.status(409).json({error:error.message||"거래를 완료하지 못했어."});}
  finally{client.release();}
});

app.post("/api/trade/session/:sessionId/decline", async(req,res)=>{
  try{const id=String(req.body.playerId||"");const r=await pool.query("UPDATE trade_sessions SET status='cancelled' WHERE id=$1 AND status='active' AND (player_a=$2 OR player_b=$2)",[req.params.sessionId,id]);if(!r.rowCount)return res.status(404).json({error:"진행 중인 거래를 찾을 수 없어."});res.json({success:true});}
  catch(error){console.error(error);res.status(500).json({error:"거래를 취소하지 못했어."});}
});

// 던전: 전투 상태를 JSON으로 보존해 새로고침 후에도 이어간다.
app.post("/api/dungeon/start", async(req,res)=>{
  try{const playerId=String(req.body.playerId||""),level=BigInt(String(req.body.level||"0"));if(!playerId||level<1n||level>1000000000n)return res.status(400).json({error:"던전 단계는 1~1,000,000,000이야."});if(!(await getPlayer(playerId)))return res.status(404).json({error:"플레이어를 찾을 수 없어."});const active=await pool.query("SELECT id FROM dungeon_runs WHERE player_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",[playerId]);if(active.rows.length)return res.status(409).json({error:"이미 진행 중인 던전이 있어."});const state={hp:String(req.body.hp||"1"),maxHp:String(req.body.maxHp||"1"),statusEffects:req.body.statusEffects||[],round:1};const r=await pool.query("INSERT INTO dungeon_runs(player_id,dungeon_level,current_round,status,state_json) VALUES($1,$2,1,'active',$3::jsonb) RETURNING id",[playerId,level.toString(),JSON.stringify(state)]);res.json({success:true,runId:String(r.rows[0].id),round:1,state});}
  catch(error){console.error(error);res.status(500).json({error:"던전을 시작하지 못했어."});}
});
app.get("/api/dungeon/current/:playerId",async(req,res)=>{try{const r=await pool.query("SELECT id,dungeon_level,current_round,state_json FROM dungeon_runs WHERE player_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",[req.params.playerId]);res.json({success:true,run:r.rows[0]?{id:String(r.rows[0].id),level:String(r.rows[0].dungeon_level),round:r.rows[0].current_round,state:r.rows[0].state_json}:null});}catch(error){console.error(error);res.status(500).json({error:"던전 진행 정보를 불러오지 못했어."});}});
app.post("/api/dungeon/advance",async(req,res)=>{try{const id=String(req.body.playerId||""),runId=String(req.body.runId||""),round=Number(req.body.round),state=req.body.state||{};if(!Number.isInteger(round)||round<1||round>15)return res.status(400).json({error:"전투 회차가 올바르지 않아."});const status=round===15?"completed":"active";const r=await pool.query("UPDATE dungeon_runs SET current_round=$1,state_json=$2::jsonb,status=$3,finished_at=CASE WHEN $3='completed' THEN NOW() ELSE NULL END WHERE id=$4 AND player_id=$5 AND status='active' RETURNING id",[round+1,JSON.stringify(state),status,runId,id]);if(!r.rowCount)return res.status(404).json({error:"진행 중인 던전을 찾을 수 없어."});res.json({success:true,completed:status==='completed'});}catch(error){console.error(error);res.status(500).json({error:"던전 진행 상태를 저장하지 못했어."});}});
app.post("/api/dungeon/abandon",async(req,res)=>{try{const r=await pool.query("UPDATE dungeon_runs SET status='failed',finished_at=NOW() WHERE id=$1 AND player_id=$2 AND status='active'",[String(req.body.runId||""),String(req.body.playerId||"")]);res.json({success:true,abandoned:r.rowCount>0});}catch(error){console.error(error);res.status(500).json({error:"던전을 종료하지 못했어."});}});

// 일일 퀘스트: KST 날짜별로 플레이어당 12개를 고정 배정한다.
app.get("/api/daily-quests/:playerId", async (req, res) => {
  const playerId = String(req.params.playerId || "");
  if (!playerId || !(await getPlayer(playerId))) return res.status(404).json({ error: "플레이어를 찾을 수 없어." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dateResult = await client.query("SELECT (NOW() AT TIME ZONE 'Asia/Seoul')::date AS today");
    const today = dateResult.rows[0].today;
    const count = await client.query("SELECT COUNT(*)::int AS n FROM player_daily_quests WHERE player_id=$1 AND quest_date=$2", [playerId, today]);
    if (Number(count.rows[0].n) === 0) {
      await client.query(`INSERT INTO player_daily_quests(player_id,quest_date,quest_id)
        SELECT $1,$2,quest_id FROM daily_quest_templates ORDER BY md5(quest_id::text || $1 || $2::text) LIMIT 12
        ON CONFLICT DO NOTHING`, [playerId, today]);
    }
    const result = await client.query(`SELECT q.quest_id,q.quest_name,q.description,q.quest_type,q.target_value,
        q.reward_json,p.progress,p.completed,p.claimed
      FROM player_daily_quests p JOIN daily_quest_templates q USING(quest_id)
      WHERE p.player_id=$1 AND p.quest_date=$2 ORDER BY q.quest_id`, [playerId, today]);
    await client.query("COMMIT");
    res.json({ success: true, date: String(today), quests: result.rows });
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} console.error(error); res.status(500).json({ error: "일일 퀘스트를 불러오지 못했어." }); }
  finally { client.release(); }
});

app.post("/api/daily-quests/progress", async (req, res) => {
  try {
    const playerId = String(req.body.playerId || ""), type = String(req.body.type || "");
    const amount = Math.max(1, Math.min(1000000, Math.floor(Number(req.body.amount) || 1)));
    const allowed = ["battle_win","dungeon_win","boss_attack","craft","material_sell","pvp_win","trade","growth"];
    if (!allowed.includes(type) || !(await getPlayer(playerId))) return res.status(400).json({ error: "퀘스트 진행 정보가 올바르지 않아." });
    await pool.query(`INSERT INTO player_daily_quests(player_id,quest_date,quest_id)
      SELECT $1,(NOW() AT TIME ZONE 'Asia/Seoul')::date,quest_id FROM daily_quest_templates
      WHERE NOT EXISTS (SELECT 1 FROM player_daily_quests WHERE player_id=$1 AND quest_date=(NOW() AT TIME ZONE 'Asia/Seoul')::date)
      ORDER BY md5(quest_id::text || $1 || (NOW() AT TIME ZONE 'Asia/Seoul')::date::text) LIMIT 12 ON CONFLICT DO NOTHING`, [playerId]);
    await pool.query(`UPDATE player_daily_quests p SET progress=LEAST(q.target_value,p.progress+$3),
        completed=(LEAST(q.target_value,p.progress+$3)>=q.target_value)
      FROM daily_quest_templates q
      WHERE p.quest_id=q.quest_id AND p.player_id=$1 AND p.quest_date=(NOW() AT TIME ZONE 'Asia/Seoul')::date
        AND q.quest_type=$2 AND p.claimed=FALSE`, [playerId,type,amount]);
    res.json({ success: true });
  } catch (error) { console.error(error); res.status(500).json({ error: "퀘스트 진행도를 저장하지 못했어." }); }
});

app.post("/api/daily-quests/claim", async (req, res) => {
  const client = await pool.connect();
  try {
    const playerId = String(req.body.playerId || ""), questId = Number(req.body.questId);
    if (!playerId || !Number.isInteger(questId)) return res.status(400).json({ error: "퀘스트 정보가 올바르지 않아." });
    await client.query("BEGIN");
    const today = await client.query("SELECT (NOW() AT TIME ZONE 'Asia/Seoul')::date AS d");
    const quest = await client.query(`SELECT p.progress,p.completed,p.claimed,q.target_value,q.reward_json
      FROM player_daily_quests p JOIN daily_quest_templates q USING(quest_id)
      WHERE p.player_id=$1 AND p.quest_date=$2 AND p.quest_id=$3 FOR UPDATE`, [playerId,today.rows[0].d,questId]);
    if (!quest.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "오늘의 퀘스트를 찾을 수 없어." }); }
    const q = quest.rows[0];
    if (!q.completed || q.claimed) { await client.query("ROLLBACK"); return res.status(400).json({ error: q.claimed ? "이미 보상을 받았어." : "아직 퀘스트가 완료되지 않았어." }); }
    const reward = typeof q.reward_json === "string" ? JSON.parse(q.reward_json) : q.reward_json;
    const gold = BigInt(String(reward.gold || "0"));
    await client.query("INSERT INTO player_game_state(player_id,money) VALUES($1,$2) ON CONFLICT(player_id) DO UPDATE SET money=player_game_state.money+EXCLUDED.money,updated_at=NOW()", [playerId,gold.toString()]);
    await client.query("UPDATE player_daily_quests SET claimed=TRUE WHERE player_id=$1 AND quest_date=$2 AND quest_id=$3", [playerId,today.rows[0].d,questId]);
    await client.query("COMMIT");
    res.json({ success: true, gold: gold.toString() });
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} console.error(error); res.status(500).json({ error: "퀘스트 보상을 지급하지 못했어." }); }
  finally { client.release(); }
});

// 길드: 한 길드 최대 30명, 플레이어는 한 길드에만 가입할 수 있다.
app.get("/api/guilds", async (req,res) => {
  try { const r=await pool.query(`SELECT g.id,g.name,g.description,g.level,g.experience,g.leader_id,COUNT(m.player_id)::int AS members
    FROM guilds g LEFT JOIN guild_members m ON m.guild_id=g.id GROUP BY g.id ORDER BY g.level DESC,g.experience DESC,g.id LIMIT 100`); res.json({success:true,guilds:r.rows}); }
  catch(e){console.error(e);res.status(500).json({error:"길드 목록을 불러오지 못했어."});}
});
app.get("/api/guilds/mine/:playerId", async(req,res)=>{
  try { const r=await pool.query(`SELECT g.id,g.name,g.description,g.level,g.experience,g.leader_id,m.role,m.contribution,m.joined_at,
      (SELECT COUNT(*)::int FROM guild_members mm WHERE mm.guild_id=g.id) AS members
    FROM guild_members m JOIN guilds g ON g.id=m.guild_id WHERE m.player_id=$1`,[String(req.params.playerId)]);
    if(!r.rows.length)return res.json({success:true,guild:null,members:[]});
    const members=await pool.query(`SELECT m.player_id,m.role,m.contribution,m.joined_at,p.name,p."heroName",p.power FROM guild_members m LEFT JOIN players p ON p.id=m.player_id WHERE m.guild_id=$1 ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,m.joined_at`,[r.rows[0].id]);
    res.json({success:true,guild:r.rows[0],members:members.rows}); }
  catch(e){console.error(e);res.status(500).json({error:"내 길드 정보를 불러오지 못했어."});}
});
app.post("/api/guilds/create", async(req,res)=>{
  const client=await pool.connect();
  try { const playerId=String(req.body.playerId||""),name=String(req.body.name||"").trim(),description=String(req.body.description||"").trim().slice(0,160);
    if(!playerId||name.length<2||name.length>24)return res.status(400).json({error:"길드 이름은 2~24자로 입력해 줘."});
    await client.query("BEGIN");
    if(!(await getPlayer(playerId)))throw new Error("플레이어를 찾을 수 없어.");
    const existing=await client.query("SELECT 1 FROM guild_members WHERE player_id=$1",[playerId]);if(existing.rowCount)throw new Error("이미 다른 길드에 가입되어 있어.");
    const g=await client.query("INSERT INTO guilds(name,leader_id,description) VALUES($1,$2,$3) RETURNING id",[name,playerId,description]);
    await client.query("INSERT INTO guild_members(guild_id,player_id,role) VALUES($1,$2,'leader')",[g.rows[0].id,playerId]);
    await client.query("COMMIT");res.json({success:true,guildId:String(g.rows[0].id)});
  } catch(e){try{await client.query("ROLLBACK");}catch{}res.status(400).json({error:e.code==='23505'?"이미 사용 중인 길드 이름이야.":e.message||"길드를 만들지 못했어."});} finally{client.release();}
});
app.post("/api/guilds/join", async(req,res)=>{
  const client=await pool.connect();try{const playerId=String(req.body.playerId||""),guildId=String(req.body.guildId||"");await client.query("BEGIN");
    if(!(await getPlayer(playerId)))throw new Error("플레이어를 찾을 수 없어.");
    const already=await client.query("SELECT 1 FROM guild_members WHERE player_id=$1",[playerId]);if(already.rowCount)throw new Error("이미 길드에 가입되어 있어.");
    const g=await client.query("SELECT id FROM guilds WHERE id=$1 FOR UPDATE",[guildId]);if(!g.rowCount)throw new Error("길드를 찾을 수 없어.");
    const count=await client.query("SELECT COUNT(*)::int AS n FROM guild_members WHERE guild_id=$1",[guildId]);if(count.rows[0].n>=30)throw new Error("길드 최대 인원 30명이 가득 찼어.");
    await client.query("INSERT INTO guild_members(guild_id,player_id) VALUES($1,$2)",[guildId,playerId]);await client.query("COMMIT");res.json({success:true});
  }catch(e){try{await client.query("ROLLBACK");}catch{}res.status(400).json({error:e.message||"길드에 가입하지 못했어."});}finally{client.release();}
});
app.post("/api/guilds/leave", async(req,res)=>{
  try{const playerId=String(req.body.playerId||"");const m=await pool.query("SELECT guild_id,role FROM guild_members WHERE player_id=$1",[playerId]);if(!m.rowCount)return res.status(404).json({error:"가입한 길드가 없어."});
    if(m.rows[0].role==='leader'){const others=await pool.query("SELECT player_id FROM guild_members WHERE guild_id=$1 AND player_id<>$2 ORDER BY joined_at LIMIT 1",[m.rows[0].guild_id,playerId]);if(others.rowCount){await pool.query("UPDATE guild_members SET role='leader' WHERE player_id=$1",[others.rows[0].player_id]);await pool.query("UPDATE guilds SET leader_id=$1 WHERE id=$2",[others.rows[0].player_id,m.rows[0].guild_id]);}else await pool.query("DELETE FROM guilds WHERE id=$1",[m.rows[0].guild_id]);}
    await pool.query("DELETE FROM guild_members WHERE player_id=$1",[playerId]);res.json({success:true});}
  catch(e){console.error(e);res.status(500).json({error:"길드를 탈퇴하지 못했어."});}
});

// PvP 랭킹
app.get("/api/rankings", async (req, res) => {
  try {
    const playerId = String(req.query.id || "");
    const result = await pool.query(`
      WITH ordered AS (
        SELECT id, name, "heroName", rank, power, wins, stats_json,
          ROW_NUMBER() OVER (
            ORDER BY wins DESC,
              CASE WHEN power ~ '^[0-9]+$' THEN power::numeric ELSE 0 END DESC,
              id ASC
          ) AS position
        FROM players
      )
      SELECT * FROM ordered ORDER BY position LIMIT 100
    `);
    let myRank = null;
    if (playerId) {
      const mine = await pool.query(`
        SELECT position FROM (
          SELECT id, ROW_NUMBER() OVER (
            ORDER BY wins DESC,
              CASE WHEN power ~ '^[0-9]+$' THEN power::numeric ELSE 0 END DESC,
              id ASC
          ) AS position
          FROM players
        ) ranked WHERE id = $1
      `, [playerId]);
      if (mine.rows[0]) myRank = Number(mine.rows[0].position);
    }
    res.json({ players: result.rows.map(toPlayer), myRank });
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
      console.log(
        `분신 키우기 서버 실행 중! 포트: ${PORT}`
      );
    });
  } catch (error) {
    console.error("서버 시작 실패:", error);
    process.exit(1);
  }
}

startServer();
