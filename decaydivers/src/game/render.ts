import type { GameState } from "./types";
import { COLORS, MISSIONS, STRATAGEMS } from "./data";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function draw(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);

  if (state.screen === "title") drawTitle(ctx, state, w, h);
  else if (state.screen === "outpost" || state.screen === "briefing") drawOutpost(ctx, state, w, h);
  else if (state.screen === "mission") drawMission(ctx, state, w, h);
  else if (state.screen === "extract") drawExtract(ctx, state, w, h);
  else if (state.screen === "gameover") drawGameOver(ctx, state, w, h);
}

function atmosphere(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 40, w * 0.5, h * 0.5, w * 0.75);
  g.addColorStop(0, "#1a2818");
  g.addColorStop(0.45, "#0f1810");
  g.addColorStop(1, "#060a07");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // drifting ash
  ctx.fillStyle = "rgba(200, 190, 150, 0.08)";
  for (let i = 0; i < 40; i++) {
    const x = ((i * 97 + t * (12 + (i % 5))) % (w + 40)) - 20;
    const y = ((i * 53 + t * (8 + (i % 7))) % (h + 40)) - 20;
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  atmosphere(ctx, w, h, state.time);

  // ground silhouette / ruin skyline
  ctx.fillStyle = "#0c140e";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  for (let x = 0; x <= w; x += 40) {
    const n = Math.sin(x * 0.01 + 1) * 18 + Math.sin(x * 0.03) * 8;
    const building = x % 160 < 70 ? 40 + (x % 50) : 0;
    ctx.lineTo(x, h * 0.72 - n - building);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();

  // hazard band
  ctx.fillStyle = "rgba(212, 160, 23, 0.12)";
  ctx.fillRect(0, h * 0.58, w, 4);

  const pulse = 0.85 + Math.sin(state.time * 2) * 0.15;

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.amber;
  ctx.font = `800 ${Math.min(96, w * 0.12)}px "Barlow Condensed", sans-serif`;
  ctx.globalAlpha = pulse;
  ctx.fillText("DECAYDIVERS", w / 2, h * 0.38);
  ctx.globalAlpha = 1;

  ctx.fillStyle = COLORS.hud;
  ctx.font = `500 ${Math.min(22, w * 0.028)}px "Share Tech Mono", monospace`;
  ctx.fillText("MANAGED SURVIVAL PROTOCOL", w / 2, h * 0.38 + 36);

  ctx.fillStyle = "rgba(184, 196, 168, 0.7)";
  ctx.font = `500 15px "Share Tech Mono", monospace`;
  ctx.fillText("Outpost grit. Hellpod doctrine. The dead do not vote.", w / 2, h * 0.38 + 64);

  // CTA
  const bw = 220;
  const bh = 48;
  const bx = w / 2 - bw / 2;
  const by = h * 0.62;
  ctx.fillStyle = COLORS.amber;
  roundRect(ctx, bx, by, bw, bh, 2);
  ctx.fill();
  ctx.fillStyle = "#121a12";
  ctx.font = `700 20px "Barlow Condensed", sans-serif`;
  ctx.fillText("DEPLOY  ·  ENTER", w / 2, by + 31);

  ctx.fillStyle = "rgba(184, 196, 168, 0.45)";
  ctx.font = `500 12px "Share Tech Mono", monospace`;
  ctx.fillText("WASD move · Mouse aim/fire · E loot · Arrow keys = stratagems", w / 2, h * 0.78);
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(212, 160, 23, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawOutpost(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  atmosphere(ctx, w, h, state.time);
  const o = state.outpost;

  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.amber;
  ctx.font = `800 42px "Barlow Condensed", sans-serif`;
  ctx.fillText(o.name, 40, 56);

  ctx.fillStyle = COLORS.hud;
  ctx.font = `500 14px "Share Tech Mono", monospace`;
  ctx.fillText(`DAY ${o.day}  ·  THREAT ${o.threat}%  ·  MORALE ${o.morale}`, 40, 82);

  ctx.fillStyle = "rgba(184, 196, 168, 0.55)";
  ctx.font = `500 12px "Share Tech Mono", monospace`;
  ctx.fillText("Keys 1–9 toggle squad · Z/X/C/V ops · click rows/cards · Space drops", 40, 100);

  // resources
  panel(ctx, 40, 110, 280, 150);
  ctx.fillStyle = COLORS.amber;
  ctx.font = `700 18px "Barlow Condensed", sans-serif`;
  ctx.fillText("STOCKPILE", 56, 138);
  ctx.fillStyle = COLORS.hud;
  ctx.font = `500 14px "Share Tech Mono", monospace`;
  const stocks = [
    ["FOOD", o.food],
    ["AMMO", o.ammo],
    ["MEDS", o.medicine],
    ["MATS", o.materials],
  ] as const;
  stocks.forEach(([label, val], i) => {
    ctx.fillText(`${label.padEnd(5)} ${val}`, 56, 168 + i * 22);
  });

  // survivors
  panel(ctx, 340, 110, Math.min(520, w - 380), 280);
  ctx.fillStyle = COLORS.amber;
  ctx.font = `700 18px "Barlow Condensed", sans-serif`;
  ctx.fillText("SURVIVORS — SELECT SQUAD (1–3)", 356, 138);

  o.survivors.forEach((s, i) => {
    const y = 158 + i * 48;
    const selected = state.selectedTeam.includes(s.id);
    if (selected) {
      ctx.fillStyle = "rgba(212, 160, 23, 0.15)";
      ctx.fillRect(356, y - 14, Math.min(488, w - 420), 42);
    }
    ctx.fillStyle = selected ? COLORS.amber : COLORS.hud;
    ctx.font = `700 16px "Barlow Condensed", sans-serif`;
    ctx.fillText(`${i + 1}. ${s.name}`, 364, y);
    ctx.fillStyle = "rgba(184, 196, 168, 0.75)";
    ctx.font = `500 12px "Share Tech Mono", monospace`;
    ctx.fillText(
      `${s.role.toUpperCase()}  HP ${s.health}  MORALE ${s.morale}  ·  ${s.traits.join(", ")}`,
      364,
      y + 18,
    );
  });

  // missions
  panel(ctx, 40, 420, w - 80, 200);
  ctx.fillStyle = COLORS.amber;
  ctx.font = `700 18px "Barlow Condensed", sans-serif`;
  ctx.fillText("OPERATION BOARD", 56, 448);

  MISSIONS.forEach((m, i) => {
    const x = 56 + i * ((w - 120) / 4);
    const active = state.selectedMission === i;
    ctx.fillStyle = active ? "rgba(212, 160, 23, 0.2)" : "rgba(255,255,255,0.03)";
    roundRect(ctx, x, 465, (w - 140) / 4 - 12, 130, 3);
    ctx.fill();
    ctx.strokeStyle = active ? COLORS.amber : "rgba(184,196,168,0.2)";
    ctx.stroke();
    ctx.fillStyle = active ? COLORS.amber : COLORS.hud;
    ctx.font = `700 14px "Barlow Condensed", sans-serif`;
    const hotkey = ["Z", "X", "C", "V"][i];
    ctx.fillText(`${hotkey}`, x + 10, 488);
    wrapText(ctx, m.title, x + 10, 510, (w - 140) / 4 - 32, 14);
    ctx.fillStyle = "rgba(184, 196, 168, 0.65)";
    ctx.font = `500 11px "Share Tech Mono", monospace`;
    wrapText(ctx, m.blurb, x + 10, 545, (w - 140) / 4 - 32, 13);
  });

  // deploy CTA
  const canDeploy = state.selectedTeam.length > 0;
  ctx.textAlign = "center";
  ctx.fillStyle = canDeploy ? COLORS.amber : "rgba(212,160,23,0.3)";
  roundRect(ctx, w / 2 - 120, h - 70, 240, 44, 2);
  ctx.fill();
  ctx.fillStyle = "#121a12";
  ctx.font = `700 20px "Barlow Condensed", sans-serif`;
  ctx.fillText(canDeploy ? "DROP  ·  SPACE" : "SELECT SQUAD", w / 2, h - 42);
  ctx.textAlign = "left";

  if (state.screen === "briefing") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, h);
    panel(ctx, w / 2 - 260, h / 2 - 100, 520, 200);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.amber;
    ctx.font = `800 28px "Barlow Condensed", sans-serif`;
    ctx.fillText("HELLPOD ARMED", w / 2, h / 2 - 40);
    ctx.fillStyle = COLORS.hud;
    ctx.font = `500 14px "Share Tech Mono", monospace`;
    ctx.fillText(MISSIONS[state.selectedMission].title, w / 2, h / 2);
    ctx.fillText("Confirm drop with SPACE — ESC abort", w / 2, h / 2 + 36);
    ctx.textAlign = "left";
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineH;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawMission(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  const m = state.mission!;
  const shakeX = state.shake ? (Math.random() - 0.5) * state.shake : 0;
  const shakeY = state.shake ? (Math.random() - 0.5) * state.shake : 0;

  const camX = state.cam.x - w / 2 + shakeX;
  const camY = state.cam.y - h / 2 + shakeY;

  // ground
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(-camX, -camY);

  // terrain noise tiles
  const tile = 80;
  const x0 = Math.floor(camX / tile) * tile;
  const y0 = Math.floor(camY / tile) * tile;
  for (let x = x0; x < camX + w + tile; x += tile) {
    for (let y = y0; y < camY + h + tile; y += tile) {
      const n = ((x * 13 + y * 7) % 5) / 5;
      ctx.fillStyle = n > 0.5 ? COLORS.grass2 : COLORS.grass;
      ctx.fillRect(x, y, tile, tile);
      if (((x + y) / tile) % 7 === 0) {
        ctx.fillStyle = COLORS.road;
        ctx.fillRect(x + 20, y, 40, tile);
      }
    }
  }

  // extract beacon
  if (m.extractOpen) {
    const pulse = 30 + Math.sin(state.time * 6) * 10;
    ctx.strokeStyle = "rgba(90, 170, 100, 0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.extractX, m.extractY, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#6aaa4a";
    ctx.beginPath();
    ctx.arc(m.extractX, m.extractY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c8c0a8";
    ctx.font = `700 14px "Barlow Condensed", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("EXTRACT", m.extractX, m.extractY - 28);
  }

  // buildings
  for (const b of m.buildings) {
    ctx.fillStyle = b.looted ? "#2a3228" : buildingColor(b.kind);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = b.looted ? "rgba(184,196,168,0.2)" : "rgba(212,160,23,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "rgba(200,192,168,0.7)";
    ctx.font = `700 12px "Barlow Condensed", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(b.looted ? "EMPTY" : b.kind.toUpperCase(), b.x + b.w / 2, b.y + b.h / 2 + 4);
  }

  // stratagem inbound markers
  for (const s of m.activeStrats) {
    if (s.phase === "inbound") {
      ctx.strokeStyle = STRATAGEMS.find((d) => d.id === s.id)?.color ?? COLORS.amber;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 70 + s.timer * 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle as string;
      ctx.font = `700 14px "Barlow Condensed", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("INBOUND", s.x, s.y - 80);
    }
  }

  // zombies
  for (const z of m.zombies) {
    const r = z.kind === "brute" ? 16 : z.kind === "runner" ? 9 : 11;
    ctx.fillStyle = z.kind === "brute" ? "#4a2018" : z.kind === "runner" ? "#3a4a28" : "#2e3a24";
    ctx.beginPath();
    ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (z.stun > 0) {
      ctx.strokeStyle = "#7a9aa8";
      ctx.stroke();
    }
    // hp pip
    ctx.fillStyle = COLORS.danger;
    ctx.fillRect(z.x - r, z.y - r - 6, (z.hp / z.maxHp) * r * 2, 3);
  }

  // companions
  for (const c of m.companions) {
    if (c.hp <= 0) continue;
    ctx.fillStyle = "#5a8ab8";
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c8c0a8";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // player / hellpod
  if (m.dropTimer > 0) {
    const p = 1 - m.dropTimer / 2.2;
    const py = m.playerY - (1 - p) * 500;
    ctx.fillStyle = COLORS.amber;
    ctx.beginPath();
    ctx.moveTo(m.playerX, py - 24);
    ctx.lineTo(m.playerX + 14, py + 16);
    ctx.lineTo(m.playerX - 14, py + 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(212,160,23,0.25)";
    ctx.beginPath();
    ctx.arc(m.playerX, m.playerY, 40 * p, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.save();
    ctx.translate(m.playerX, m.playerY);
    ctx.rotate(m.facing);
    ctx.fillStyle = m.invuln > 0 && Math.floor(state.time * 20) % 2 === 0 ? "#c8c0a8" : COLORS.amber;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // bullets
  ctx.fillStyle = "#f0e8c8";
  for (const b of m.bullets) {
    ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
  }

  // particles
  for (const p of m.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, `rgba(6,10,7,${0.35 + m.fog * 0.35})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  drawMissionHud(ctx, state, w, h);
}

function buildingColor(kind: string) {
  switch (kind) {
    case "clinic":
      return "#2a3a38";
    case "armory":
      return "#3a3228";
    case "store":
      return "#2e3428";
    case "ruin":
      return "#242820";
    default:
      return "#303828";
  }
}

function drawMissionHud(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  const m = state.mission!;
  // top bar
  ctx.fillStyle = "rgba(10,16,12,0.75)";
  ctx.fillRect(0, 0, w, 56);
  ctx.fillStyle = COLORS.amber;
  ctx.font = `700 18px "Barlow Condensed", sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`HP ${Math.ceil(m.playerHp)}`, 20, 34);
  ctx.fillText(`TIME ${Math.ceil(m.timeLeft)}s`, 120, 34);
  ctx.fillText(`KILLS ${m.killCount}`, 250, 34);
  const loot = `F${m.lootBag.food ?? 0} A${m.lootBag.ammo ?? 0} M${m.lootBag.medicine ?? 0} T${m.lootBag.materials ?? 0}`;
  ctx.fillText(loot, 360, 34);
  ctx.fillStyle = COLORS.hud;
  ctx.font = `500 12px "Share Tech Mono", monospace`;
  ctx.fillText(`AMMO POOL ${state.outpost.ammo + (m.lootBag.ammo ?? 0)}`, 520, 34);

  if (m.messageTimer > 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.amber;
    ctx.font = `800 26px "Barlow Condensed", sans-serif`;
    ctx.globalAlpha = Math.min(1, m.messageTimer);
    ctx.fillText(m.message, w / 2, 96);
    ctx.globalAlpha = 1;
  }

  // stratagem panel
  panel(ctx, 16, h - 170, 320, 154);
  ctx.fillStyle = COLORS.amber;
  ctx.font = `700 14px "Barlow Condensed", sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("STRATAGEMS  (arrow keys)", 28, h - 146);
  STRATAGEMS.forEach((s, i) => {
    const y = h - 126 + i * 22;
    const cd = m.cooldowns[s.id] ?? 0;
    ctx.fillStyle = cd > 0 ? "rgba(184,196,168,0.35)" : s.color;
    ctx.font = `500 12px "Share Tech Mono", monospace`;
    const code = s.code.map(arrow).join("");
    ctx.fillText(`${code}  ${s.name}${cd > 0 ? ` (${cd | 0}s)` : ""}`, 28, y);
  });

  // input buffer
  if (m.stratInput.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = m.stratFlash > 0 ? COLORS.ok : COLORS.amber;
    ctx.font = `800 36px "Barlow Condensed", sans-serif`;
    ctx.fillText(m.stratInput.map(arrow).join(" "), w / 2, h - 40);
  }

  // minimap
  const mmW = 140;
  const mmH = 105;
  const mmX = w - mmW - 16;
  const mmY = h - mmH - 16;
  ctx.fillStyle = "rgba(10,16,12,0.85)";
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeStyle = "rgba(212,160,23,0.4)";
  ctx.strokeRect(mmX, mmY, mmW, mmH);
  const sx = mmW / m.worldW;
  const sy = mmH / m.worldH;
  ctx.fillStyle = "#6aaa4a";
  if (m.extractOpen) ctx.fillRect(mmX + m.extractX * sx - 2, mmY + m.extractY * sy - 2, 4, 4);
  ctx.fillStyle = "#9a3b2a";
  for (const z of m.zombies) {
    ctx.fillRect(mmX + z.x * sx, mmY + z.y * sy, 2, 2);
  }
  ctx.fillStyle = COLORS.amber;
  ctx.fillRect(mmX + m.playerX * sx - 2, mmY + m.playerY * sy - 2, 4, 4);
}

function arrow(d: string) {
  return d === "U" ? "↑" : d === "D" ? "↓" : d === "L" ? "←" : "→";
}

function drawExtract(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  atmosphere(ctx, w, h, state.time);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.amber;
  ctx.font = `800 48px "Barlow Condensed", sans-serif`;
  ctx.fillText("MISSION DEBRIEF", w / 2, h * 0.32);
  ctx.fillStyle = COLORS.hud;
  ctx.font = `500 15px "Share Tech Mono", monospace`;
  const lines = wrapLines(ctx, state.lastExtractSummary, 560);
  lines.forEach((line, i) => ctx.fillText(line, w / 2, h * 0.4 + i * 24));

  ctx.fillStyle = COLORS.amber;
  roundRect(ctx, w / 2 - 130, h * 0.58, 260, 48, 2);
  ctx.fill();
  ctx.fillStyle = "#121a12";
  ctx.font = `700 20px "Barlow Condensed", sans-serif`;
  ctx.fillText("RETURN TO OUTPOST · ENTER", w / 2, h * 0.58 + 31);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawGameOver(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  atmosphere(ctx, w, h, state.time);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.danger;
  ctx.font = `800 56px "Barlow Condensed", sans-serif`;
  ctx.fillText("OUTPOST LOST", w / 2, h * 0.38);
  ctx.fillStyle = COLORS.hud;
  ctx.font = `500 16px "Share Tech Mono", monospace`;
  ctx.fillText(
    `Survived ${state.outpost.day} days · ${state.outpost.missionsWon} ops · ${state.outpost.kills} kills`,
    w / 2,
    h * 0.48,
  );
  ctx.fillText("Democracy delayed is democracy denied.", w / 2, h * 0.54);
  ctx.fillStyle = COLORS.amber;
  roundRect(ctx, w / 2 - 110, h * 0.62, 220, 48, 2);
  ctx.fill();
  ctx.fillStyle = "#121a12";
  ctx.font = `700 20px "Barlow Condensed", sans-serif`;
  ctx.fillText("REDEPLOY · ENTER", w / 2, h * 0.62 + 31);
}
