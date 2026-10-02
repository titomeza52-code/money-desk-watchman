import type { Dir, GameState, MissionState } from "./types";
import { STRATAGEMS, clamp, codeMatch, dist, makeSurvivor } from "./data";
import { spawnHorde } from "./mission";

function addLoot(
  bag: MissionState["lootBag"],
  key: "food" | "ammo" | "medicine" | "materials",
  n: number,
) {
  bag[key] = (bag[key] ?? 0) + n;
}

function burst(m: MissionState, x: number, y: number, color: string, n = 10, speed = 120) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = Math.random() * speed;
    m.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.3 + Math.random() * 0.5,
      maxLife: 0.8,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function tryLoot(m: MissionState) {
  for (const b of m.buildings) {
    if (b.looted) continue;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (dist(m.playerX, m.playerY, cx, cy) < Math.max(b.w, b.h) * 0.55) {
      b.looted = true;
      for (const [k, v] of Object.entries(b.loot)) {
        if (v) addLoot(m.lootBag, k as keyof typeof b.loot, v);
      }
      m.message = `LOOTED ${b.kind.toUpperCase()}`;
      m.messageTimer = 1.6;
      burst(m, cx, cy, "#d4a017", 14, 90);
      return;
    }
  }
}

function fire(m: MissionState, aimX: number, aimY: number, fromX = m.playerX, fromY = m.playerY, dmg = 18) {
  const a = Math.atan2(aimY - fromY, aimX - fromX);
  const spread = (Math.random() - 0.5) * 0.08;
  const speed = 620;
  m.bullets.push({
    x: fromX + Math.cos(a) * 18,
    y: fromY + Math.sin(a) * 18,
    vx: Math.cos(a + spread) * speed,
    vy: Math.sin(a + spread) * speed,
    life: 0.9,
    damage: dmg,
  });
  burst(m, fromX + Math.cos(a) * 16, fromY + Math.sin(a) * 16, "#c8c0a8", 3, 40);
}

function damagePlayer(state: GameState, m: MissionState, amount: number) {
  if (m.invuln > 0 || m.dropTimer > 0) return;
  m.playerHp -= amount;
  m.invuln = 0.55;
  state.shake = Math.max(state.shake, 8);
  burst(m, m.playerX, m.playerY, "#9a3b2a", 8, 70);
  if (m.playerHp <= 0) {
    m.playerHp = 0;
    m.message = "OPERATIVE DOWN";
    m.messageTimer = 3;
  }
}

function activateStratagem(state: GameState, m: MissionState, id: string) {
  const def = STRATAGEMS.find((s) => s.id === id);
  if (!def) return;
  if ((m.cooldowns[id] ?? 0) > 0) {
    m.message = `${def.name} RECHARGING`;
    m.messageTimer = 1.2;
    return;
  }
  m.cooldowns[id] = def.cooldown;
  m.stratInput = [];
  m.stratFlash = 0.4;
  m.activeStrats.push({
    id,
    x: m.playerX,
    y: m.playerY,
    timer: id === "eagle" ? 0.9 : 1.6,
    phase: "inbound",
  });
  m.message = `${def.name} INBOUND`;
  m.messageTimer = 1.4;
  state.shake = Math.max(state.shake, 4);
}

function resolveStratagem(state: GameState, m: MissionState, s: MissionState["activeStrats"][0]) {
  if (s.id === "orbital" || s.id === "eagle") {
    const radius = s.id === "orbital" ? 160 : 90;
    const damage = s.id === "orbital" ? 120 : 70;
    for (const z of m.zombies) {
      if (dist(z.x, z.y, s.x, s.y) < radius) {
        z.hp -= damage;
        z.stun = Math.max(z.stun, 0.4);
        burst(m, z.x, z.y, "#d4a017", 6, 100);
      }
    }
    burst(m, s.x, s.y, s.id === "orbital" ? "#d4a017" : "#c45c2a", 40, 220);
    state.shake = Math.max(state.shake, 16);
  } else if (s.id === "resupply") {
    addLoot(m.lootBag, "ammo", 18);
    addLoot(m.lootBag, "medicine", 3);
    m.playerHp = Math.min(m.playerMaxHp, m.playerHp + 25);
    burst(m, s.x, s.y, "#6aaa4a", 20, 80);
    m.message = "RESUPPLY SECURED";
    m.messageTimer = 1.5;
  } else if (s.id === "stun") {
    for (const z of m.zombies) {
      if (dist(z.x, z.y, s.x, s.y) < 220) z.stun = Math.max(z.stun, 3.2);
    }
    burst(m, s.x, s.y, "#7a9aa8", 30, 140);
  } else if (s.id === "reinforce") {
    const down = m.companions.find((c) => c.hp <= 0);
    if (down) {
      down.hp = 80;
      down.x = m.playerX + 30;
      down.y = m.playerY;
      m.message = "REINFORCEMENT DROPPED";
    } else {
      m.companions.push({
        id: `temp-${Date.now()}`,
        x: m.playerX - 30,
        y: m.playerY,
        hp: 70,
        reload: 0,
      });
      m.message = "AUXILIARY DIVER ON STATION";
    }
    m.messageTimer = 1.8;
    burst(m, m.playerX, m.playerY, "#5a8ab8", 24, 100);
  }
}

export function pushStratInput(state: GameState, dir: Dir) {
  const m = state.mission;
  if (!m || state.screen !== "mission") return;
  m.stratInput.push(dir);
  if (m.stratInput.length > 6) m.stratInput.shift();
  for (const s of STRATAGEMS) {
    if (codeMatch(m.stratInput, s.code)) {
      activateStratagem(state, m, s.id);
      break;
    }
  }
}

export function updateMission(state: GameState, dt: number) {
  const m = state.mission;
  if (!m) return;

  if (m.dropTimer > 0) {
    m.dropTimer -= dt;
    if (m.dropTimer <= 0) {
      m.dropped = true;
      m.message = "BOOTS ON GROUND — LOOT & EXTRACT";
      m.messageTimer = 2.5;
      burst(m, m.playerX, m.playerY, "#d4a017", 28, 160);
      state.shake = 12;
    }
    return;
  }

  m.timeLeft -= dt;
  if (m.timeLeft <= 30 && !m.extractOpen) {
    m.extractOpen = true;
    m.message = "EXTRACT BEACON ONLINE — MOVE";
    m.messageTimer = 3;
  }
  if (m.timeLeft <= 0) {
    m.timeLeft = 0;
    m.playerHp = 0;
    m.message = "MISSION TIMER EXPIRED";
  }

  if (m.messageTimer > 0) m.messageTimer -= dt;
  if (m.stratFlash > 0) m.stratFlash -= dt;
  if (m.reload > 0) m.reload -= dt;
  if (m.invuln > 0) m.invuln -= dt;

  for (const k of Object.keys(m.cooldowns)) {
    m.cooldowns[k] = Math.max(0, (m.cooldowns[k] ?? 0) - dt);
  }

  // Movement
  let mx = 0;
  let my = 0;
  if (state.keys.has("w") || state.keys.has("arrowup")) my -= 1;
  if (state.keys.has("s") || state.keys.has("arrowdown")) my += 1;
  if (state.keys.has("a") || state.keys.has("arrowleft")) mx -= 1;
  if (state.keys.has("d") || state.keys.has("arrowright")) mx += 1;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    mx /= len;
    my /= len;
    const speed = state.keys.has("shift") ? 210 : 155;
    m.playerX = clamp(m.playerX + mx * speed * dt, 40, m.worldW - 40);
    m.playerY = clamp(m.playerY + my * speed * dt, 40, m.worldH - 40);
  }

  m.facing = Math.atan2(state.mouse.worldY - m.playerY, state.mouse.worldX - m.playerX);

  if (state.mouse.down && m.reload <= 0 && m.playerHp > 0) {
    const ammo = state.outpost.ammo + (m.lootBag.ammo ?? 0);
    if (ammo > 0) {
      fire(m, state.mouse.worldX, state.mouse.worldY);
      m.reload = 0.14;
      if ((m.lootBag.ammo ?? 0) > 0) m.lootBag.ammo! -= 1;
      else state.outpost.ammo = Math.max(0, state.outpost.ammo - 1);
    } else {
      m.message = "OUT OF AMMO — CALL RESUPPLY";
      m.messageTimer = 1.2;
      m.reload = 0.4;
    }
  }

  if (state.keys.has("e")) {
    tryLoot(m);
    state.keys.delete("e");
  }

  // Extract check
  if (
    m.extractOpen &&
    m.playerHp > 0 &&
    dist(m.playerX, m.playerY, m.extractX, m.extractY) < 55
  ) {
    finishMission(state, true);
    return;
  }

  // Horde waves
  m.hordeTimer -= dt;
  if (m.hordeTimer <= 0) {
    spawnHorde(m, state.outpost.threat, m.playerX, m.playerY);
    m.hordeTimer = 28 + Math.random() * 18;
  }

  // Stratagems resolve
  for (const s of m.activeStrats) {
    s.timer -= dt;
    if (s.timer <= 0 && s.phase === "inbound") {
      s.phase = "impact";
      resolveStratagem(state, m, s);
      s.timer = 0.35;
    } else if (s.timer <= 0 && s.phase === "impact") {
      s.phase = "done";
    }
  }
  m.activeStrats = m.activeStrats.filter((s) => s.phase !== "done");

  // Bullets
  for (const b of m.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
  }
  m.bullets = m.bullets.filter((b) => b.life > 0);

  // Zombies
  for (const z of m.zombies) {
    if (z.stun > 0) {
      z.stun -= dt;
      continue;
    }
    const dPlayer = dist(z.x, z.y, m.playerX, m.playerY);
    if (dPlayer < 340) z.aggro = true;
    let tx = z.x;
    let ty = z.y;
    if (z.aggro && m.playerHp > 0) {
      tx = m.playerX;
      ty = m.playerY;
    } else {
      // idle wander toward nearest building
      const b = m.buildings[z.id % m.buildings.length];
      if (b) {
        tx = b.x + b.w / 2;
        ty = b.y + b.h / 2;
      }
    }
    const a = Math.atan2(ty - z.y, tx - z.x);
    z.x += Math.cos(a) * z.speed * dt;
    z.y += Math.sin(a) * z.speed * dt;

    if (dPlayer < (z.kind === "brute" ? 28 : 22) && m.playerHp > 0) {
      const dmg = z.kind === "brute" ? 22 : z.kind === "runner" ? 10 : 12;
      damagePlayer(state, m, dmg * dt * 3.2);
    }

    // bullet hits
    for (const b of m.bullets) {
      if (dist(b.x, b.y, z.x, z.y) < (z.kind === "brute" ? 22 : 16)) {
        z.hp -= b.damage;
        b.life = 0;
        z.aggro = true;
        z.stun = Math.max(z.stun, 0.05);
        burst(m, z.x, z.y, "#8b3a2a", 4, 60);
      }
    }
  }

  // deaths
  const before = m.zombies.length;
  m.zombies = m.zombies.filter((z) => {
    if (z.hp > 0) return true;
    m.killCount += 1;
    burst(m, z.x, z.y, "#6e1f18", 12, 90);
    return false;
  });
  if (m.zombies.length < before) state.outpost.kills += before - m.zombies.length;

  // Companions
  for (const c of m.companions) {
    if (c.hp <= 0) continue;
    const follow = dist(c.x, c.y, m.playerX, m.playerY);
    if (follow > 70) {
      const a = Math.atan2(m.playerY - c.y, m.playerX - c.x);
      c.x += Math.cos(a) * 130 * dt;
      c.y += Math.sin(a) * 130 * dt;
    }
    c.reload -= dt;
    let nearest: { x: number; y: number; d: number } | null = null;
    for (const z of m.zombies) {
      const d = dist(c.x, c.y, z.x, z.y);
      if (d < 280 && (!nearest || d < nearest.d)) nearest = { x: z.x, y: z.y, d };
      if (d < 22) {
        c.hp -= 18 * dt;
      }
    }
    if (nearest && c.reload <= 0 && (state.outpost.ammo > 0 || (m.lootBag.ammo ?? 0) > 0)) {
      fire(m, nearest.x, nearest.y, c.x, c.y, 12);
      c.reload = 0.35;
      if ((m.lootBag.ammo ?? 0) > 0) m.lootBag.ammo! -= 1;
      else state.outpost.ammo = Math.max(0, state.outpost.ammo - 1);
    }
  }

  // Particles
  for (const p of m.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= dt;
  }
  m.particles = m.particles.filter((p) => p.life > 0);

  // Camera
  state.cam.x = m.playerX;
  state.cam.y = m.playerY;

  if (m.playerHp <= 0) {
    m.deathTimer = (m.deathTimer ?? 1.8) - dt;
    if (m.deathTimer <= 0) finishMission(state, false);
  }
}

export function finishMission(state: GameState, success: boolean) {
  const m = state.mission;
  if (!m) return;

  const team = state.outpost.survivors.filter((s) => state.selectedTeam.includes(s.id));
  for (const s of team) s.onMission = false;

  if (success) {
    state.outpost.food += m.lootBag.food ?? 0;
    state.outpost.ammo += m.lootBag.ammo ?? 0;
    state.outpost.medicine += m.lootBag.medicine ?? 0;
    state.outpost.materials += m.lootBag.materials ?? 0;
    state.outpost.missionsWon += 1;
    state.outpost.morale = clamp(state.outpost.morale + 6, 0, 100);
    state.outpost.threat = clamp(state.outpost.threat + 4, 0, 100);

    // injury chance
    for (const s of team) {
      if (Math.random() > 0.75) {
        s.health = clamp(s.health - 15, 10, s.maxHealth);
        s.morale = clamp(s.morale - 5, 0, 100);
      } else {
        s.morale = clamp(s.morale + 4, 0, 100);
      }
    }

    // player-as-commander wear
    const lead = team[0];
    if (lead) lead.health = clamp(m.playerHp, 5, lead.maxHealth);

    state.lastExtractSummary = `EXTRACT OK — +${m.lootBag.food ?? 0} food, +${m.lootBag.ammo ?? 0} ammo, +${m.lootBag.medicine ?? 0} meds, +${m.lootBag.materials ?? 0} mats · ${m.killCount} kills`;
    state.screen = "extract";
  } else {
    state.outpost.morale = clamp(state.outpost.morale - 18, 0, 100);
    state.outpost.threat = clamp(state.outpost.threat + 10, 0, 100);
    // permanent death chance for squad
    for (const s of team) {
      if (Math.random() > 0.45) {
        s.dead = true;
        s.health = 0;
      } else {
        s.health = clamp(s.health - 40, 1, s.maxHealth);
        s.morale = clamp(s.morale - 20, 0, 100);
      }
    }
    state.outpost.survivors = state.outpost.survivors.filter((s) => !s.dead);
    state.lastExtractSummary = `MISSION FAILED — casualties reported. The dead do not vote.`;
    if (state.outpost.survivors.length === 0) {
      state.screen = "gameover";
    } else {
      state.screen = "extract";
    }
  }

  state.mission = null;
  state.selectedTeam = [];
}

export function advanceDay(state: GameState) {
  const o = state.outpost;
  o.day += 1;
  const mouths = Math.max(1, o.survivors.length);
  o.food = Math.max(0, o.food - mouths * 2);
  if (o.food <= 0) {
    o.morale = clamp(o.morale - 12, 0, 100);
    for (const s of o.survivors) s.morale = clamp(s.morale - 8, 0, 100);
  } else {
    o.morale = clamp(o.morale + 2, 0, 100);
  }

  // heal with medicine
  for (const s of o.survivors) {
    if (s.health < s.maxHealth && o.medicine > 0) {
      s.health = clamp(s.health + 20, 0, s.maxHealth);
      o.medicine -= 1;
    }
  }

  o.threat = clamp(o.threat + 2 + (o.day % 3 === 0 ? 3 : 0), 0, 100);

  // recruit chance
  if (o.survivors.length < 8 && o.morale > 45 && Math.random() > 0.55) {
    const newbie = makeSurvivor();
    o.survivors.push(newbie);
    state.lastExtractSummary += ` · New survivor: ${newbie.name}`;
  }

  if (o.morale <= 0 || o.survivors.length === 0) {
    state.screen = "gameover";
  }
}
