import type { Dir, StratagemDef, Survivor } from "./types";

export const WORLD = { W: 3200, H: 2400 };

export const COLORS = {
  bg: "#0a100c",
  fog: "#142018",
  grass: "#1a2a1c",
  grass2: "#152218",
  road: "#2a2e28",
  olive: "#4a5c38",
  amber: "#d4a017",
  rust: "#9a3b2a",
  blood: "#6e1f18",
  bone: "#c8c0a8",
  hud: "#b8c4a8",
  danger: "#e0452a",
  ok: "#6aaa4a",
  panel: "rgba(10, 16, 12, 0.88)",
};

export const STRATAGEMS: StratagemDef[] = [
  {
    id: "orbital",
    name: "ORBITAL BARRAGE",
    code: ["R", "D", "L", "R"],
    cooldown: 28,
    description: "Rain freedom on a cluster of the undead.",
    color: "#d4a017",
  },
  {
    id: "eagle",
    name: "EAGLE STRAFE",
    code: ["U", "R", "D"],
    cooldown: 18,
    description: "Fast air support. Clears a lane.",
    color: "#c45c2a",
  },
  {
    id: "resupply",
    name: "RESUPPLY DROP",
    code: ["D", "D", "U", "R"],
    cooldown: 35,
    description: "Ammo + medicine crate at your feet.",
    color: "#6aaa4a",
  },
  {
    id: "reinforce",
    name: "REINFORCE",
    code: ["U", "D", "R", "L", "U"],
    cooldown: 45,
    description: "Drop a spare diver if a teammate fell.",
    color: "#5a8ab8",
  },
  {
    id: "stun",
    name: "EMS MORTAR",
    code: ["D", "L", "D", "U"],
    cooldown: 22,
    description: "Stun pulse. Buy time to loot / extract.",
    color: "#7a9aa8",
  },
];

const FIRST = ["Mara", "Dex", "Kim", "Rook", "Vale", "Ash", "Nova", "Reed", "Juno", "Cruz"];
const LAST = ["Hale", "Voss", "Pike", "Ortez", "Quinn", "Sato", "Briggs", "Kade", "Sol", "Nyx"];
const TRAITS = [
  "Quiet hands",
  "Bad knee",
  "Night owl",
  "Loud boots",
  "Lucky shot",
  "Panic eater",
  "Iron stomach",
  "Soft heart",
  "Blood oath",
  "Democracy or death",
];

let sid = 0;

export function makeSurvivor(forced?: Partial<Survivor>): Survivor {
  sid += 1;
  const roleRoll = Math.random();
  const role: Survivor["role"] =
    roleRoll < 0.35 ? "rifle" : roleRoll < 0.55 ? "scout" : roleRoll < 0.75 ? "medic" : "engineer";
  const name = `${FIRST[(Math.random() * FIRST.length) | 0]} ${LAST[(Math.random() * LAST.length) | 0]}`;
  const traits = [TRAITS[(Math.random() * TRAITS.length) | 0]];
  if (Math.random() > 0.55) traits.push(TRAITS[(Math.random() * TRAITS.length) | 0]);
  return {
    id: `s${sid}`,
    name,
    role,
    health: 100,
    maxHealth: 100,
    morale: 55 + ((Math.random() * 30) | 0),
    traits,
    onMission: false,
    dead: false,
    ...forced,
  };
}

export function freshOutpost() {
  const survivors = [
    makeSurvivor({ name: "Commander Vale", role: "rifle", morale: 80, traits: ["Blood oath"] }),
    makeSurvivor({ name: "Scout Nyx", role: "scout", morale: 70, traits: ["Night owl"] }),
    makeSurvivor({ name: "Doc Reed", role: "medic", morale: 65, traits: ["Soft heart"] }),
    makeSurvivor(),
  ];
  return {
    name: "OUTPOST HELIX",
    day: 1,
    food: 40,
    ammo: 80,
    medicine: 12,
    materials: 20,
    morale: 70,
    survivors,
    threat: 18,
    missionsWon: 0,
    kills: 0,
  };
}

export const MISSIONS = [
  {
    id: 0,
    title: "SUPPLY RUN — RUST HOLLOW",
    blurb: "Scavenge the strip mall. Extract before the dead notice freedom.",
    duration: 140,
    zombieBase: 28,
    rewardBias: "food" as const,
  },
  {
    id: 1,
    title: "ARMORY SWEEP — SECTOR 7",
    blurb: "Recover munitions. Democracy is hungry for brass.",
    duration: 150,
    zombieBase: 36,
    rewardBias: "ammo" as const,
  },
  {
    id: 2,
    title: "CLINIC RAID — ASHWARD",
    blurb: "Medicine for the living. Mercy for nobody else.",
    duration: 160,
    zombieBase: 42,
    rewardBias: "medicine" as const,
  },
  {
    id: 3,
    title: "HIGH THREAT — NEST BREACH",
    blurb: "Clear a nest. Expect brutes. Expect regrets.",
    duration: 180,
    zombieBase: 55,
    rewardBias: "materials" as const,
  },
];

export function codeMatch(input: Dir[], code: Dir[]): boolean {
  if (input.length < code.length) return false;
  const slice = input.slice(-code.length);
  return slice.every((d, i) => d === code[i]);
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function dist(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

export function randRange(a: number, b: number) {
  return a + Math.random() * (b - a);
}

export function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}
