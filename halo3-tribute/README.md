# RINGFALL — Halo 3 Tribute

Unofficial browser FPS inspired by the *feel* of Halo 3 multiplayer. Original code and art — not affiliated with Microsoft, Bungie, or 343 Industries.

## Play

```bash
cd halo3-tribute
npm install
npm run dev
```

Open the local URL, click **DEPLOY**, then click the game to lock the mouse.

## Controls

| Input | Action |
|-------|--------|
| WASD | Move |
| Mouse | Aim |
| LMB | Fire |
| R | Reload |
| 1 / 2 | Battle Rifle / Plasma Pistol |
| G | Frag grenade |
| F | Melee |
| Space | Jump |
| Shift | Sprint |
| Esc | Pause (releases pointer) |

## Goal

Survive **5 waves** of Grunt- and Elite-class hostiles in a canyon arena. Shields recharge after you stop taking damage — classic energy-shield cadence.

## Stack

Vite + TypeScript + Three.js. Static build via `npm run build` → `dist/`.
