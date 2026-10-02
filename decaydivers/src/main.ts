import "./style.css";
import type { Dir, GameState } from "./game/types";
import { freshOutpost, MISSIONS } from "./game/data";
import { createMission } from "./game/mission";
import { advanceDay, pushStratInput, updateMission } from "./game/sim";
import { draw } from "./game/render";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1 class="sr-only">Decaydivers — Managed Survival</h1>
  <canvas id="game"></canvas>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;

function createState(): GameState {
  return {
    screen: "title",
    outpost: freshOutpost(),
    mission: null,
    selectedTeam: [],
    selectedMission: 0,
    keys: new Set(),
    mouse: { x: 0, y: 0, down: false, worldX: 0, worldY: 0 },
    cam: { x: 0, y: 0 },
    time: 0,
    shake: 0,
    lastExtractSummary: "",
  };
}

let state = createState();

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resize();
window.addEventListener("resize", resize);

function syncMouseWorld() {
  if (!state.mission) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  state.mouse.worldX = state.cam.x - w / 2 + state.mouse.x;
  state.mouse.worldY = state.cam.y - h / 2 + state.mouse.y;
}

window.addEventListener("mousemove", (e) => {
  state.mouse.x = e.clientX;
  state.mouse.y = e.clientY;
  syncMouseWorld();
});

window.addEventListener("mousedown", () => {
  state.mouse.down = true;
});
window.addEventListener("mouseup", () => {
  state.mouse.down = false;
});

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  state.keys.add(key);

  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
    e.preventDefault();
  }

  // Stratagem arrows during mission
  if (state.screen === "mission") {
    const map: Record<string, Dir> = {
      arrowup: "U",
      arrowdown: "D",
      arrowleft: "L",
      arrowright: "R",
    };
    if (map[key]) pushStratInput(state, map[key]);
  }

  handleAction(key, e);
});

window.addEventListener("keyup", (e) => {
  state.keys.delete(e.key.toLowerCase());
});

function handleAction(key: string, e: KeyboardEvent) {
  if (state.screen === "title" && (key === "enter" || key === " ")) {
    state.screen = "outpost";
    return;
  }

  if (state.screen === "gameover" && (key === "enter" || key === " ")) {
    state = createState();
    state.screen = "outpost";
    return;
  }

  if (state.screen === "extract" && (key === "enter" || key === " ")) {
    advanceDay(state);
    if (state.screen === "extract") state.screen = "outpost";
    return;
  }

  if (state.screen === "briefing") {
    if (key === "escape") {
      state.screen = "outpost";
      return;
    }
    if (key === " " || key === "enter") {
      startMission();
      return;
    }
  }

  if (state.screen === "outpost") {
    // select survivors 1-9
    if (key >= "1" && key <= "9") {
      const idx = Number(key) - 1;
      const s = state.outpost.survivors[idx];
      if (!s) return;
      const i = state.selectedTeam.indexOf(s.id);
      if (i >= 0) state.selectedTeam.splice(i, 1);
      else if (state.selectedTeam.length < 3) state.selectedTeam.push(s.id);
      return;
    }
    // mission select
    if (key === "q") {
      // cycle with q? use  digits with shift? use [ ]
    }
    if (e.code.startsWith("Digit") && e.altKey) {
      const n = Number(e.key) - 1;
      if (n >= 0 && n < MISSIONS.length) state.selectedMission = n;
    }
    if (key === "[" || key === "]") {
      const d = key === "]" ? 1 : -1;
      state.selectedMission = (state.selectedMission + d + MISSIONS.length) % MISSIONS.length;
    }
    // also F1-F4
    if (key.startsWith("f") && key.length === 2) {
      const n = Number(key[1]) - 1;
      if (n >= 0 && n < MISSIONS.length) state.selectedMission = n;
    }
    // clickable via number row when holding? Use Z X C V
    if (key === "z") state.selectedMission = 0;
    if (key === "x") state.selectedMission = 1;
    if (key === "c") state.selectedMission = 2;
    if (key === "v") state.selectedMission = 3;

    if ((key === " " || key === "enter") && state.selectedTeam.length > 0) {
      state.screen = "briefing";
    }
  }
}

// Mouse clicks for UI
canvas.addEventListener("click", (e) => {
  const x = e.clientX;
  const y = e.clientY;
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (state.screen === "title") {
    state.screen = "outpost";
    return;
  }
  if (state.screen === "extract") {
    advanceDay(state);
    if (state.screen === "extract") state.screen = "outpost";
    return;
  }
  if (state.screen === "gameover") {
    state = createState();
    state.screen = "outpost";
    return;
  }
  if (state.screen === "briefing") {
    startMission();
    return;
  }
  if (state.screen === "outpost") {
    // mission cards
    MISSIONS.forEach((_, i) => {
      const mx = 56 + i * ((w - 120) / 4);
      const my = 465;
      const mw = (w - 140) / 4 - 12;
      if (x >= mx && x <= mx + mw && y >= my && y <= my + 130) {
        state.selectedMission = i;
      }
    });
    // survivor rows
    state.outpost.survivors.forEach((s, i) => {
      const sy = 158 + i * 48 - 14;
      if (x >= 356 && x <= 356 + 488 && y >= sy && y <= sy + 42) {
        const idx = state.selectedTeam.indexOf(s.id);
        if (idx >= 0) state.selectedTeam.splice(idx, 1);
        else if (state.selectedTeam.length < 3) state.selectedTeam.push(s.id);
      }
    });
    // deploy button
    if (x >= w / 2 - 120 && x <= w / 2 + 120 && y >= h - 70 && y <= h - 26) {
      if (state.selectedTeam.length > 0) state.screen = "briefing";
    }
  }
});

function startMission() {
  const companions = state.selectedTeam.slice(1);
  for (const id of state.selectedTeam) {
    const s = state.outpost.survivors.find((x) => x.id === id);
    if (s) s.onMission = true;
  }
  state.mission = createMission(state.selectedMission, state.outpost.threat, companions);
  // scale player HP from lead survivor
  const lead = state.outpost.survivors.find((s) => s.id === state.selectedTeam[0]);
  if (lead && state.mission) {
    state.mission.playerHp = lead.health;
    state.mission.playerMaxHp = lead.maxHealth;
  }
  state.cam.x = state.mission.playerX;
  state.cam.y = state.mission.playerY;
  state.screen = "mission";
}

let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.time += dt;
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);

  if (state.screen === "mission" && state.mission) {
    syncMouseWorld();
    updateMission(state, dt);
  }

  draw(ctx, state, window.innerWidth, window.innerHeight);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
