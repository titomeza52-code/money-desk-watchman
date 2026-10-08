import type { Building, MissionState, Zombie } from "./types";
import { MISSIONS, WORLD, pick, randRange } from "./data";

let zid = 1;

function makeZombie(x: number, y: number, threat: number): Zombie {
  const roll = Math.random() + threat / 200;
  let kind: Zombie["kind"] = "walker";
  if (roll > 0.92) kind = "brute";
  else if (roll > 0.72) kind = "runner";

  const stats =
    kind === "brute"
      ? { hp: 90, speed: 42 }
      : kind === "runner"
        ? { hp: 28, speed: 95 }
        : { hp: 35, speed: 55 };

  return {
    id: zid++,
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed + randRange(-5, 8),
    kind,
    stun: 0,
    aggro: Math.random() > 0.65,
  };
}

function placeBuildings(bias: string): Building[] {
  const buildings: Building[] = [];
  const kinds: Building["kind"][] = ["house", "house", "store", "ruin", "clinic", "armory", "house", "store", "ruin"];
  for (let i = 0; i < 14; i++) {
    let kind = pick(kinds);
    if (bias === "ammo" && i < 3) kind = "armory";
    if (bias === "medicine" && i < 3) kind = "clinic";
    if (bias === "food" && i < 3) kind = "store";
    const w = kind === "ruin" ? 70 : 90 + ((Math.random() * 40) | 0);
    const h = kind === "ruin" ? 60 : 70 + ((Math.random() * 35) | 0);
    const x = 180 + Math.random() * (WORLD.W - 360 - w);
    const y = 180 + Math.random() * (WORLD.H - 360 - h);
    const overlaps = buildings.some(
      (b) => Math.abs(b.x - x) < b.w + w + 40 && Math.abs(b.y - y) < b.h + h + 40,
    );
    if (overlaps) continue;

    const loot: Building["loot"] = {};
    if (kind === "store") {
      loot.food = 4 + ((Math.random() * 8) | 0);
      loot.ammo = 2 + ((Math.random() * 4) | 0);
    } else if (kind === "clinic") {
      loot.medicine = 3 + ((Math.random() * 5) | 0);
      loot.food = 1 + ((Math.random() * 2) | 0);
    } else if (kind === "armory") {
      loot.ammo = 8 + ((Math.random() * 12) | 0);
      loot.materials = 2 + ((Math.random() * 4) | 0);
    } else if (kind === "house") {
      loot.food = 2 + ((Math.random() * 4) | 0);
      loot.ammo = 1 + ((Math.random() * 3) | 0);
      if (Math.random() > 0.6) loot.medicine = 1;
    } else {
      loot.materials = 3 + ((Math.random() * 6) | 0);
      if (Math.random() > 0.5) loot.ammo = 2;
    }

    buildings.push({ x, y, w, h, kind, looted: false, loot });
  }
  return buildings;
}

export function createMission(
  missionId: number,
  threat: number,
  companionIds: string[],
): MissionState {
  const def = MISSIONS[missionId] ?? MISSIONS[0];
  const buildings = placeBuildings(def.rewardBias);
  const zombies: Zombie[] = [];
  const count = def.zombieBase + Math.floor(threat / 4);

  for (let i = 0; i < count; i++) {
    let x = randRange(100, WORLD.W - 100);
    let y = randRange(100, WORLD.H - 100);
    // Keep spawn away from drop zone center
    while (dist2(x, y, WORLD.W * 0.5, WORLD.H * 0.5) < 280) {
      x = randRange(100, WORLD.W - 100);
      y = randRange(100, WORLD.H - 100);
    }
    zombies.push(makeZombie(x, y, threat));
  }

  const extractAngle = Math.random() * Math.PI * 2;
  const extractDist = 900 + Math.random() * 500;

  return {
    seed: (Math.random() * 1e9) | 0,
    timeLeft: def.duration,
    extractOpen: false,
    extractX: clamp(WORLD.W * 0.5 + Math.cos(extractAngle) * extractDist, 200, WORLD.W - 200),
    extractY: clamp(WORLD.H * 0.5 + Math.sin(extractAngle) * extractDist, 200, WORLD.H - 200),
    buildings,
    zombies,
    bullets: [],
    particles: [],
    activeStrats: [],
    killCount: 0,
    lootBag: {},
    playerX: WORLD.W * 0.5,
    playerY: WORLD.H * 0.5,
    playerHp: 100,
    playerMaxHp: 100,
    facing: 0,
    reload: 0,
    invuln: 2.5,
    dropped: false,
    dropTimer: 2.2,
    message: "HELLPOD INBOUND — SPREAD MANAGED SURVIVAL",
    messageTimer: 3.5,
    stratInput: [],
    stratFlash: 0,
    cooldowns: {},
    companionIds,
    companions: companionIds.map((id, i) => ({
      id,
      x: WORLD.W * 0.5 + (i + 1) * 28,
      y: WORLD.H * 0.5 + (i % 2 === 0 ? 20 : -20),
      hp: 100,
      reload: 0,
    })),
    worldW: WORLD.W,
    worldH: WORLD.H,
    fog: 0.35 + threat / 200,
    hordeTimer: 25 + Math.random() * 20,
  };
}

function dist2(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function spawnHorde(m: MissionState, threat: number, nearX: number, nearY: number) {
  const n = 6 + ((threat / 15) | 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 420 + Math.random() * 180;
    const z = makeZombie(nearX + Math.cos(a) * r, nearY + Math.sin(a) * r, threat + 20);
    z.aggro = true;
    m.zombies.push(z);
  }
  m.message = "HORDE SURGE — CALL FREEDOM";
  m.messageTimer = 2.5;
}
