# DECAYDIVERS

A browser game mashup of **State of Decay 2** (outpost survival, scavenging, permanent death) and **Helldivers 2** (hellpod drops, arrow-code stratagems, managed-democracy satire).

## Play

```bash
cd decaydivers
npm install
npm run dev
```

Then open the local URL Vite prints.

## Controls

| Context | Input |
|--------|--------|
| Title / menus | Click or Enter |
| Outpost | `1–9` select squad (up to 3) · `Z/X/C/V` pick operation · Space to drop |
| Mission | `WASD` move · `Shift` sprint · Mouse aim/fire · `E` loot |
| Stratagems | Arrow keys enter codes (see on-screen list) |

### Stratagem codes

- ↑→↓ — Eagle Strafe
- →↓←→ — Orbital Barrage
- ↓↓↑→ — Resupply Drop
- ↑↓→←↑ — Reinforce
- ↓←↓↑ — EMS Mortar

## Loop

1. Manage **Outpost Helix**: food, ammo, meds, materials, morale, threat.
2. Deploy a squad into a sector.
3. Scavenge buildings, hold off the dead, call stratagems.
4. Reach the extract beacon before the timer dies.
5. Failed ops can permanently kill survivors. Empty outpost = game over.

## Deploy (Netlify)

`decaydivers/netlify.toml` builds this folder. Base directory: `decaydivers`.
