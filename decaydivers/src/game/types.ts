export type Screen = "title" | "outpost" | "briefing" | "mission" | "extract" | "gameover";

export type Dir = "U" | "D" | "L" | "R";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Survivor {
  id: string;
  name: string;
  role: "rifle" | "scout" | "medic" | "engineer";
  health: number;
  maxHealth: number;
  morale: number;
  traits: string[];
  onMission: boolean;
  dead: boolean;
}

export interface OutpostState {
  name: string;
  day: number;
  food: number;
  ammo: number;
  medicine: number;
  materials: number;
  morale: number;
  survivors: Survivor[];
  threat: number;
  missionsWon: number;
  kills: number;
}

export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "house" | "store" | "clinic" | "armory" | "ruin";
  looted: boolean;
  loot: Partial<Record<"food" | "ammo" | "medicine" | "materials", number>>;
}

export interface Zombie {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  kind: "walker" | "runner" | "brute";
  stun: number;
  aggro: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface StratagemDef {
  id: string;
  name: string;
  code: Dir[];
  cooldown: number;
  description: string;
  color: string;
}

export interface ActiveStratagem {
  id: string;
  x: number;
  y: number;
  timer: number;
  phase: "inbound" | "impact" | "done";
}

export interface MissionState {
  seed: number;
  timeLeft: number;
  extractOpen: boolean;
  extractX: number;
  extractY: number;
  buildings: Building[];
  zombies: Zombie[];
  bullets: Bullet[];
  particles: Particle[];
  activeStrats: ActiveStratagem[];
  killCount: number;
  lootBag: Partial<Record<"food" | "ammo" | "medicine" | "materials", number>>;
  playerX: number;
  playerY: number;
  playerHp: number;
  playerMaxHp: number;
  facing: number;
  reload: number;
  invuln: number;
  dropped: boolean;
  dropTimer: number;
  message: string;
  messageTimer: number;
  stratInput: Dir[];
  stratFlash: number;
  cooldowns: Record<string, number>;
  companionIds: string[];
  companions: { id: string; x: number; y: number; hp: number; reload: number }[];
  worldW: number;
  worldH: number;
  fog: number;
  hordeTimer: number;
  deathTimer?: number;
}

export interface GameState {
  screen: Screen;
  outpost: OutpostState;
  mission: MissionState | null;
  selectedTeam: string[];
  selectedMission: number;
  keys: Set<string>;
  mouse: { x: number; y: number; down: boolean; worldX: number; worldY: number };
  cam: Vec2;
  time: number;
  shake: number;
  lastExtractSummary: string;
}
