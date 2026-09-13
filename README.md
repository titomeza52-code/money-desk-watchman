# money-desk-watchman

Cloudflare Worker edge watchman for Money Desk soft-cap **observation**.

## Law (L3)
- NEVER place / cancel / modify orders.
- NEVER HMAC Coinbase from the Worker. No trading keys on CF.
- Public Coinbase market data for tape drift; **Desk pushes** book pulse (keys stay on box/Desk).
- Leo / couple-inbox bridge is **DEAD** — do not wake chat; alerts stay in D1 (+ R2 artifacts).

## Stack
- Wrangler Worker (TypeScript): `money-desk-watchman` (v1.6.7 as_of reject + /health wake contract + pulse_stale observe)
- D1: `money-desk-watchman-db` (binding `DB`) — critical flags + checks/alerts
- R2: `ego-artifacts` (binding `ARTIFACTS`) — structured pulses + fill receipts
- Crons (UTC): `*/15 * * * *` watch; `15 10 * * *` night-school; `0 10 * * SUN` dreaming (CF Quartz: use SUN not 0)
- Secret: `ADMIN_TOKEN` (wrangler secret + local `.dev.vars` mode 600)
- Vars: `DRIFT_PCT`, `WORKER_NAME`, `BOOK_MARK_USD` (default 130 soft-cap proxy)

## Routes
| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Desk pull / **wake contract**: `pulse_stale`, `pulse_stale_minutes`, `never_pulsed`, `wake: { needed, reason, kind: desk_feeder, action: "POST /admin/book-pulse", url_configured }` (no GET side effects). Also predict clip fields; book pulse fields; `transient_fetch` / `transient_fetch_products` / `last_transient_error` (no alert) |
| GET | `/` | Landing |
| GET | `/admin/flags` | x-admin-token — soft_cap_flag + pulse snapshot + `pulse_stale` / `wake` for Usage/Desk |
| POST | `/admin/book-pulse` | x-admin-token — Desk/box feeder snapshot; **requires `as_of` ISO-8601**; 400 `as_of_missing` / `as_of_invalid` / `as_of_future` / `as_of_stale` (does not refresh `last_pulse_ts`) |
| POST | `/admin/predict-clip` | x-admin-token — Predict cash-out observe clip / `{clear:true}` |
| POST | `/admin/fill-receipt` | x-admin-token — sanitized fill JSON → R2 `fills/YYYY-MM-DD/<id>.json` |
| POST | `/admin/force-alert` | x-admin-token — synthetic drift; respects kill-switch |
| POST | `/admin/run-check` | x-admin-token — scheduled-equivalent run |
| POST | `/admin/night-school` | x-admin-token — lessons pass |
| POST | `/admin/dreaming` | x-admin-token — dry-run Sunday clustering |
| POST | `/admin/alerts-enabled` | x-admin-token — body `{0\|1}` or `{"alerts_enabled":0\|1}` |
| POST | `/admin/policy` | x-admin-token — soft_cap_usd, book_mark_usd, stale_order_minutes, cooldown, etc. |

## Book pulse schema
```json
{
  "as_of": "2026-09-13T00:20:00.000Z",
  "book_mark_usd": 132.99,
  "wreck_pause_usd": 113,
  "wreck_kill_usd": 92,
  "open_order_count": 0,
  "morpho_usd": 11.31,
  "dry_usd": 6.91,
  "predict_sleeve_net": -1.22,
  "soft_cap_util_pct": null
}
```
- **`as_of` required** — ISO-8601 snapshot time of the live book (not overlay standing date). Stored as D1 `last_pulse_ts` (age is snapshot age, not ingest wall clock).
- Reject **400** (no state write of a fresh pulse): missing/blank → `as_of_missing`; non-string/unparseable → `as_of_invalid`; future beyond 120s skew → `as_of_future`; older than `policy.pulse_stale_minutes` (default 45) → `as_of_stale`.
- Nulls accepted for missing numeric fields (do not invent numbers).
- Defaults: `wreck_pause_usd=113`, `wreck_kill_usd=92` when omitted.
- Stores latest in D1 `state` + `checks` row `source=book_pulse`.
- When ARTIFACTS bound: R2 `pulses/YYYY-MM-DD/HHMM.json`.
- Alert (dedup+cooldown) if `book_mark_usd ≤ 118` OR `predict_sleeve_net ≤ -4` — human action only, no executable orders.
- Alert (dedup+cooldown) `morpho_dry_idle` if `dry_usd ≥ 5` AND `morpho_usd > 0` — observe-only idle leak (park dry→Morpho when convert works); **muted** when pulse/overlay `morpho_convert_blocked` is true (BLOCKED_CONVERT / dry USD silo); no orders from Worker.
- If `soft_cap_util_pct > 25` → D1 `soft_cap_flag=1` (else 0 when util provided).


## Predict cash-out (observe)
```json
{
  "market_id": "SYNTH-DEMO-MKT",
  "side": "YES",
  "contracts": 10,
  "cost_all_in": 4.0,
  "max_payout": 10.0,
  "mark_now": 0.85,
  "expiry_ts": "2026-09-08T01:00:00Z",
  "fee_exit_est": 0.02
}
```
- Clear: `{"clear":true}` (also auto-clears on expiry).
- Alert once when mark_up ≥ 0.70×(max_payout−cost) AND ≥ 0.50; dedup until clear.
- R2: `predicts/YYYY-MM-DD/…`. Wake only if env `COINBASE_WAKE_URL` set.
- Never HMAC / never orders from Worker.

## Box feeder (no keys in Worker)
```bash
# from project root; reads ADMIN_TOKEN from .dev.vars
python3 scripts/push-book-pulse.py
```
- Reads `/workspace/jarvis-hud/live.json` (fallback paths documented in script).
- Maps: `book_mark`→`book_mark_usd`, `morpho_usdc`→`morpho_usd`, `usd_cash`/`dry_usdc`→`dry_usd`, `len(open_orders)`→`open_order_count`, wreck lines.
- **Dark-field overlays (never invent):**
  - `predict_sleeve_net` — Coinbase-locked primary: `/workspace/audit/predict/sleeve_net.json` (`predict_sleeve_net`|`sleeve_net`|`net`); fallback: first existing `desk-overlay.json` (`/workspace/jarvis-hud/desk-overlay.json` then `/workspace/projects/money-desk-watchman/desk-overlay.json`).
  - `soft_cap_util_pct` — overlay/Usage only if present; never invent.
- Desk/Coinbase: after each `live.json` refresh (+ sleeve settle → update `sleeve_net.json`), run this script **or** `curl -X POST …/admin/book-pulse -H "x-admin-token: $ADMIN_TOKEN" -d @pulse.json`.
- Optional cron: attach to whatever already schedules Desk refresh. **Do not invent a Meza Task Scheduler** — none was found on disk; wire existing Desk cron/job only.

## Behavior (tape watch)
1. Fetch Coinbase Exchange public tickers for BTC-USD + ETH-USD.
2. Drift/alert if hard fetch fail, mid move > DRIFT_PCT, `stale_watch`, `pulse_stale` (last_pulse_ts set and older than `pulse_stale_minutes`; bootstrap null skips), or admin force. HTTP 429/5xx: check + `last_transient_error` only (no alert; `last_error` stays clean). Partial OK still refreshes `last_ok_check_ts` so sticky 429s do not fire `stale_watch`.
3. Always insert checks. Alerts only if `alerts_enabled=1` and fingerprint not within cooldown. First `pulse_stale` alert also POSTs `COINBASE_WAKE_URL` when set (`kind=pulse_stale`); GET `/health` never wakes.
4. Night-school / Dreaming unchanged (D1 lessons SoT; R2 optional md).

## /health wake contract (Desk pull)
Desk polls GET `/health` (no side effects). When `wake.needed` is true, Desk must `POST /admin/book-pulse` with a fresh `as_of`.
- `wake.reason=never_pulsed` — bootstrap; `pulse_stale` stays false (no false-fire).
- `wake.reason=pulse_stale` — `last_pulse_ts` is set and older than `pulse_stale_minutes`.
- `wake.url_configured` — whether optional `COINBASE_WAKE_URL` is set (URL is never returned).
- HTTP 200 while D1 is ok even if pulse is stale; `ok` tracks bindings, not feeder liveness.

## Parked
- Analytics Engine time-series, Vectorize, Pages dashboard.
- Worker-held READ-ONLY Coinbase key / true open-order stale.
- Live account balances via CF (Desk push is the path).

## Ops mirrors
- Receipts: `/workspace/jarvis-os/_ops/receipts/`
- Disk mirror: `/workspace/jarvis-os/_ops/watchman/last.json`
- Lessons: `LESSONS.md`
