# LESSONS — money-desk-watchman

## 2026-09-07 first build

### What broke
1. D1 create failed: Cloudflare API 10000 Authentication error. Account role Super Admin does not imply token scopes. Exact permission: Account D1 Edit.
2. R2 parked: API 10042 enable R2 in Dashboard; then Account R2 Storage Edit. Binding commented in wrangler.toml.
3. Prefer absolute Node PATH; never echo secrets.
4. Old limited CLOUDFLARE_API_TOKEN breaks D1 even when OAuth has d1:write — must unset token and use OAuth only.

### What fixed / worked
- Live Coinbase public tickers BTC-USD ETH-USD OK from box.
- wrangler deploy --dry-run bundle ~17KiB OK with crons.
- .dev.vars ADMIN_TOKEN mode 600 set (not printed).
- couple-inbox not touched.
- Wrangler OAuth (coachmeza42@gmail.com, d1:write) created D1 `640e8406-f3b6-4a00-beb1-3ad05ceb92d9`, bound DB, secret put, deploy, /health 200 d1_ok=true, admin run-check + force-alert, counts checks=2 alerts=1.

### Do not retry
- Do not paste secrets into chat/receipts/git.
- Do not set CLOUDFLARE_API_TOKEN for this Worker while OAuth is the working path.
- Do not wake Leo/couple-inbox.
- No Coinbase trading keys in env.
- No fake ticker numbers.

### Next unpark (superseded by R2 attempt below)
1. Crons already live (*/15 + 15 10 UTC); monitor disk mirror last.json after cron fires.
2. R2 still blocked — see 2026-09-07 R2 enable attempt.

## 2026-09-07 R2 enable attempt (OAuth)

### What broke
1. `npx wrangler r2 bucket list` and `npx wrangler r2 bucket create ego-artifacts` both failed with Cloudflare API **10042**: Please enable R2 through the Cloudflare Dashboard.
2. Auth path was correct: CLOUDFLARE_API_TOKEN unset; Wrangler OAuth coachmeza42@gmail.com (account 2b738f63f372671143e317e7cdb0e15c). OAuth scopes present do not substitute for product enablement.

### What fixed / worked
- Stopped per policy — did not invent success, did not uncomment [[r2_buckets]], did not redeploy with ARTIFACTS.
- Worker code already optional-writes night-school markdown when ARTIFACTS bound; D1 lessons remain source of truth; /health independent of R2.
- GET /health still HTTP 200 d1_ok=true on existing deploy version 239bf0fd-e64a-4c79-87c7-37f3f2e50529.

### Do not retry
- Do not retry bucket create until Miguel enables R2 in Cloudflare Dashboard.
- Do not set CLOUDFLARE_API_TOKEN for this Worker.
- Do not bind ARTIFACTS in wrangler.toml while create fails.

### Next unpark
1. Human: enable R2 in Cloudflare Dashboard for account 2b738f63f372671143e317e7cdb0e15c.
2. Then (OAuth only, token unset): `wrangler r2 bucket create ego-artifacts`, uncomment [[r2_buckets]] ARTIFACTS, redeploy, smoke put/list/get/delete.
3. Leave R2 parked until that dashboard enable.

## 2026-09-07 Phase2 R2 after Miguel enable (still 10042 — STOP)

### What broke
1. Miguel reported R2 enabled ("done"). Re-ran with CLOUDFLARE_API_TOKEN unset; nvm use 22; Wrangler OAuth only.
2. `npx wrangler r2 bucket create ego-artifacts` → API **10042** Please enable R2 through the Cloudflare Dashboard.
3. `npx wrangler r2 bucket list` → same **10042**.
4. `wrangler whoami` OAuth scopes still list no `r2` (d1 write present). 10042 message is product-enable, not a silent scope miss — but re-login may be needed after true enable.

### What fixed / worked
- Stopped per policy: did **not** uncomment `[[r2_buckets]]`, did **not** redeploy, did **not** smoke put/list/get/delete.
- Evidence saved (screenshot-path + logs):
  - `/workspace/jarvis-os/_ops/watchman/evidence/r2-10042-2026-09-07T1929Z.png`
  - `/workspace/jarvis-os/_ops/watchman/evidence/r2-10042-2026-09-07T1929Z.txt`
  - create/list wrangler logs under same evidence dir
- GET /health still HTTP 200 `d1_ok=true` on version `239bf0fd-e64a-4c79-87c7-37f3f2e50529`.
- Worker already optional-writes night-school md when `ARTIFACTS` bound; D1 lessons remain SoT.

### Do not retry
- Do not retry bucket create until dashboard truly shows R2 enabled for account `2b738f63f372671143e317e7cdb0e15c` (and ideally re-auth wrangler if r2 scope missing).
- Do not set CLOUDFLARE_API_TOKEN.
- Do not bind ARTIFACTS while create fails.

### Next unpark
1. Human: confirm R2 **Enabled** in CF Dashboard → R2 for that account (not just a permission toggle elsewhere).
2. If enabled but still 10042: `npx wrangler logout && npx wrangler login` then retry create (may need r2 OAuth scope).
3. Then: create `ego-artifacts`, uncomment `[[r2_buckets]]` ARTIFACTS, optional `/health` `r2_ok`, redeploy, smoke put/list/get/delete `smoke/test.txt`.

## 2026-09-07 Phase2 R2 SUCCESS (Miguel enabled)

### What broke
1. Prior attempts failed with API **10042** until Dashboard showed Overview + Create bucket.
2. First smoke without `--remote` hit local R2 sim — remotes need `--remote` on wrangler r2 object put/get/delete.

### What fixed / worked
- CLOUDFLARE_API_TOKEN unset; nvm 22; OAuth coachmeza42@gmail.com only.
- `npx wrangler r2 bucket create ego-artifacts` → Created (Standard).
- Enabled `[[r2_buckets]]` binding ARTIFACTS → ego-artifacts in wrangler.toml.
- Added `/health` `r2_ok` (ARTIFACTS.head probe).
- Redeploy version `9c7e16a1-f30d-4663-af0f-031bf2fd8642`; GET /health HTTP 200 d1_ok=true r2_ok=true.
- Remote smoke: put/get/delete `smoke/test.txt` with `--remote` OK; post-delete get → key does not exist.

### Do not retry
- Do not set CLOUDFLARE_API_TOKEN while OAuth works.
- Do not paste secrets into chat/receipts/git.
- Do not wake Leo/couple-inbox.

### Next unpark
1. Monitor cron disk mirror last.json + night-school optional R2 markdown writes.
2. Keep D1 lessons as source of truth; ARTIFACTS is optional artifact store.

## 2026-09-07 Phase 4 hardening + watchman + dreaming

### What broke
1. Cloudflare cron rejected `0 10 * * 0` (API 10100). CF Quartz weekdays are **1=SUN … 7=SAT**; day `0` is invalid. Use `0 10 * * SUN` (or `0 10 * * 1`).
2. First Phase4 deploy uploaded code but only partially updated triggers until cron string fixed.

### What fixed / worked
- Auth: CLOUDFLARE_API_TOKEN unset; nvm 22; Wrangler OAuth only.
- 4A: fingerprint dedup + unique `alerts_dedup` + free hash after cooldown; `/health` adds `last_error` (nullable). No Leo/partner-key/inbox paths.
- 4B: kill-switch `POST /admin/alerts-enabled` ironclad (checks continue, posts silenced); `util_pct=book_mark_usd/soft_cap_usd*100` in every alert body (state `book_mark_usd`, default/env 130); `POST /admin/policy`; `stale_watch` when `last_ok_check_ts` older than `policy.stale_order_minutes`.
- 4C: cron `0 10 * * SUN`; `runDreaming` clusters 7d lessons, archives duplicate rule text, writes R2 `dreaming/YYYY-MM-DD.md` + artifacts_index; `POST /admin/dreaming` dry-run. No chat/Grok wake.
- Prove: health JSON with last_error; toggle 0/1 (silenced force); force util_pct=86.7; force×2 → alertId then deduped; dreaming scanned=14 kept=7 archived=7.
- Version: `032618c1-e0ff-4c07-9e57-cf9827dbcf97`.

### Do not retry
- Do not use cron day-of-week `0` on Cloudflare — use `SUN`/`1`.
- Do not invent Coinbase fills/orders or add trading keys.
- Do not wake Leo/couple-inbox.
- Do not set CLOUDFLARE_API_TOKEN while OAuth works.

### Parked
1. **Real open-order stale detector** needs a READ-ONLY Coinbase API key (account orders). Until then only `stale_watch` (watchman outage gap) is live.
2. Account balances / true utilization — L3 public data only; `book_mark_usd` is an admin-seeded soft-cap proxy.
3. Partner-key / Leo inbox bridges remain dead by design.

### Next unpark
1. Optional: Miguel supplies READ-ONLY Coinbase key → implement true open-order stale (still no place/cancel/modify).
2. Monitor Sunday dreaming cron + 15m watch + night-school 10:15 UTC.

## 2026-09-07 Book-pulse / fill-receipt / soft-cap flag (Coinbase observe lane)

### Research bake-in (public patterns)
1. **Structured pulse JSON → R2** — Durable artifacts under `pulses/YYYY-MM-DD/HHMM.json` (and fills under `fills/…`). Matches CF guidance: bindings over REST; R2 for object history.
2. **D1 for critical flags** — `state` k/v holds `book_mark_usd`, `soft_cap_flag`, `last_pulse_ts`; `checks` rows for audit. Health/Desk read D1, not R2 scans.
3. **One alert then silence** — fingerprint dedup + `alert_cooldown_minutes` + unique index (phase4) applied to book-pulse wreck/sleeve kinds.
4. **`/health` as single Desk pull** — binding proof (`d1_ok`/`r2_ok`) plus pulse snapshot (`book_mark_usd`, `sleeve_net`, `last_pulse_ts`, `alert_armed`, `soft_cap_flag`). Public monitor writeups converge on health-with-dependency-checks.

### What shipped
- `POST /admin/book-pulse` (x-admin-token): store state + checks `source=book_pulse` + R2 pulse; alert if mark≤118 or sleeve≤−4 (human action only).
- `POST /admin/fill-receipt`: sanitize secrets → R2 + artifacts_index.
- Soft-cap: `soft_cap_util_pct > 25` → `soft_cap_flag=1`; `GET /admin/flags` + `/health`.
- Box feeder `scripts/push-book-pulse.py` reads live.json, nulls missing fields, POSTs with ADMIN_TOKEN from `.dev.vars`.
- Auth: CLOUDFLARE_API_TOKEN unset; OAuth only; nvm 22.
- Version: `6fd8e579-c32c-4697-8af1-8818d3965d6b`.

### Dark fields (live.json 2026-09-07)
- `predict_sleeve_net` — absent (null accepted).
- `soft_cap_util_pct` — absent (null; Desk can compute later).
- Mapped: book_mark→book_mark_usd, morpho_usdc→morpho_usd, usd_cash→dry_usd, open_orders len, wreck_pause/kill.

### Park for later
- Analytics Engine time-series, Vectorize, Worker-held RO Coinbase key, Pages dashboard.

### Do not retry
- Worker HMAC / trading keys / place-cancel-modify.
- Inventing sleeve/mark numbers as real.
- Inventing Meza Task Scheduler (none on disk) — wire existing Desk cron only.
- CLOUDFLARE_API_TOKEN while OAuth works; Leo/couple-inbox wake.

## 2026-09-07 Predict cash-out observe alert (Coinbase PRIORITY)

### Spec shipped
1. `POST /admin/predict-clip` (x-admin-token): open clip with market_id, side, contracts, cost_all_in, max_payout (default contracts*$1), mark_now (bid for sell), expiry_ts, fee_exit_est optional; or `{"clear":true}` / auto-clear on expiry.
2. `mark_up = mark_now*contracts - cost_all_in`. Alert **once** when `mark_up >= 0.70*(max_payout-cost_all_in)` AND `mark_up >= 0.50`. Dedup until clear/flat/settle (clip-scoped; not book-pulse global cooldown).
3. `/health` adds `predict_clip_open`, `cash_out_alert_armed`, optional `predict_mark_up`.
4. Clip in D1 `state`; optional R2 under `predicts/YYYY-MM-DD/…`.
5. Wake webhook **only** if `COINBASE_WAKE_URL` set — skipped when absent (`wake=skipped_no_url`).
6. Never HMAC; never place/cancel/modify orders.

### Prove (synthetic — not real money)
- Auth: CLOUDFLARE_API_TOKEN unset; OAuth coachmeza42@gmail.com; nvm 22.
- Version: `9e380213-7d7b-4bc3-bacf-7ebd48b01e25` (package 1.6.0).
- Synthetic open: market_id=SYNTH-DEMO-MKT side=YES contracts=10 cost_all_in=4 max_payout=10 mark_now=0.85 → mark_up=4.5 → alertId=3; R2 `predicts/2026-09-07/1957.json`; wake skipped_no_url.
- Second POST same clip → deduped=true alertId=null.
- Clear → predict_clip_open=false cash_out_alert_armed=false; R2 clear pulse.
- Health after open: predict_clip_open=true, cash_out_alert_armed=false (fired), predict_mark_up=4.5.
- Health after clear: predict_clip_open=false, cash_out_alert_armed=false (no predict_mark_up).

### Do not retry
- Do not invent real Predict PnL / live money claims in proves.
- Do not set CLOUDFLARE_API_TOKEN while OAuth works.
- Do not add HMAC / trading keys / place-cancel.
- Do not wake Leo/couple-inbox; optional Desk wake is COINBASE_WAKE_URL only.

### Parked
- COINBASE_WAKE_URL not set (intentional skip).
- True live Predict mark feed (Desk/box pushes clip snapshots).

## 2026-09-08 Coinbase HTTP 429 ≠ watchman alert

### What broke
1. Public Coinbase ticker `HTTP 429` (BTC-USD/ETH-USD) was pushed into drift `reasons` as `fetch_failure`.
2. That armed the alert path: inserted `alerts` row, bumped `last_alert_ts` / cooldown — Desk pinged on rate-limit noise (see last.json `last_error=ETH-USD: HTTP 429` with matching `last_alert_ts`).

### What fixed / worked
1. `isTransientFetchStatus`: **429** and **5xx** are transient — recorded in checks `payload.fetch_errors` + `state.last_error`; **not** added to alert `reasons`.
2. No `alerts` insert, no `last_alert_ts` bump, no cooldown from transient fetch alone. Hard fetch failures + price_move + stale_watch + book-pulse + predict cash-out + soft_cap still alert as before.
3. Auth: `CLOUDFLARE_API_TOKEN` unset; Wrangler OAuth; nvm 22. Package **1.6.1**. Version: `a29646d8-801f-4fb5-9de3-a307608a1ab9`.
4. Prove: `POST /admin/run-check` → ok tickers=2 drift=false alertId=null; `/health` last_alert_ts unchanged from prior real alert window; last_error=null when fetch OK.

### Do not retry
- Do not treat public ticker 429 as Desk ping / alert_armed signal.
- Do not set CLOUDFLARE_API_TOKEN while OAuth works.
- Do not wake Leo/couple-inbox; no trading keys / HMAC.

## 2026-09-08 Transient 429 must not poison last_ok → stale_watch

### What broke
1. After 1.6.1 muted 429 alerts, failed fetches still skipped `last_ok_check_ts` updates (`fetchOk` required all products).
2. Sticky public ticker 429s aged `last_ok_check_ts` past `stale_order_minutes` → `stale_watch` alert — undoing Miguel's 429 mute.
3. Transient noise also sat in `last_error`, making `/health` look broken.

### What fixed / worked
1. After fetch loop: `hardFetchFail` / `transientOnly` / `partialOk`. Hard fail → `fetch_failure` reasons as before.
2. `last_ok_check_ts` + merged `last_mids_json` update when `partialOk && !hardFetchFail`. Transient-only → `last_transient_error` (not `last_error`).
3. `checks.ok` still strict (all PRODUCTS). `price_move` runs on `partialOk` for products present in both mids maps.
4. `/health` always returns `transient_fetch`, `transient_fetch_products`, `last_transient_error` — observe only, never bumps `last_alert_ts`.
5. Package **1.6.2**. Version: `3747a7b8-bcd6-42ef-a86d-714bbeb2ae9d`. Auth: CLOUDFLARE_API_TOKEN unset; OAuth; nvm 22.
6. Prove: GET /health new fields present; POST /admin/run-check tickers=2 drift=false alertId=null; last_alert_ts stayed `2026-09-08T12:00:19.569Z`.

### Do not retry
- Do not let transient ticker 429 age into `stale_watch`.
- Do not set CLOUDFLARE_API_TOKEN while OAuth works.
- Do not wake Leo/couple-inbox; no trading keys / HMAC.

## 2026-09-08 min-Miguel CF upgrades (1.6.3)

### Spec shipped
1. **morpho_dry_idle** tripwire in `ingestBookPulse`: if `dry_usd != null && morpho_usd != null && dry_usd >= 5 && morpho_usd > 0` → alert kind `book_pulse:morpho_dry_idle` (dedup+cooldown). Observe-only idle leak — Coinbase parks dry→Morpho when convert works. No orders from Worker. Constant `BOOK_PULSE_DRY_IDLE_USD = 5`.
2. Feeder dark-field overlays: `predict_sleeve_net` prefers Coinbase-locked `/workspace/audit/predict/sleeve_net.json` then `desk-overlay.json` (jarvis-hud first, project second). `soft_cap_util_pct` only from overlay if present — never invent.
3. Package **1.6.3**. Version `50b1d96c-cd11-45ec-96e4-2d80e2ccedec`. Min-Miguel standing: ship observe-only without Miguel for items 2/3/5-class autonomous work; Wake URL remains optional paste.
4. Prove: GET /health ok; book-pulse dry=6.91 morpho=11.31 → alertId=6 `morpho_dry_idle` (intended); sleeve from `/workspace/audit/predict/sleeve_net.json` (-1.22); soft_cap_util_pct stayed dark.

### Do not retry
- Do not invent `soft_cap_util_pct` or sleeve numbers.
- Do not place/cancel/modify from Worker; no HMAC / trading keys.
- Do not set CLOUDFLARE_API_TOKEN while OAuth works; no Leo/couple-inbox wake.

## 2026-09-08 morpho_convert_blocked mutes morpho_dry_idle (1.6.4)

### What broke
1. Coinbase reported BLOCKED_CONVERT 2026-09-08 (dry USD silo) — Morpho convert known-blocked.
2. Watchman still fired `morpho_dry_idle` whenever dry≥5 && morpho>0, even when convert cannot park dry→Morpho.

### What fixed / worked
1. `BookPulse` / `parseBookPulse`: optional `morpho_convert_blocked` (bool or 1/0).
2. `ingestBookPulse`: still stores dry/morpho; sets state `morpho_convert_blocked`; if pulse flag true, **skips** morpho_dry_idle alert path.
3. `push-book-pulse.py`: if desk-overlay.json has truthy `morpho_convert_blocked`, includes `morpho_convert_blocked: true` on pulse.
4. Package **1.6.4**. Version `be3e37bc-9c87-4d07-8db4-46b1aac7a4cf`. Auth: CLOUDFLARE_API_TOKEN unset; OAuth; nvm 22.
5. Prove: GET /health ok; book-pulse dry=6.91 morpho=11.31 + morpho_convert_blocked=true → alertId=null; last_alert_ts unchanged.

### Do not retry
- Do not alert morpho_dry_idle while convert is known-blocked.
- Do not invent soft_cap_util_pct / sleeve; no orders/HMAC; no CLOUDFLARE_API_TOKEN while OAuth works.

## 2026-09-08 pulse_stale Desk feeder dead (1.6.5)

### Spec shipped
1. Policy field `pulse_stale_minutes` (default **45**) via migrate ALTER + getPolicy coalesce + admin `/admin/policy`; constant `PULSE_STALE_MINUTES=45` fallback.
2. In `runWatch` after other checks: if `last_pulse_ts` is **set** and age > threshold → reason kind `pulse_stale` (detail with age minutes). Dedup+cooldown via existing drifted alert path. Bootstrap null `last_pulse_ts` does **not** fire.
3. `/health` adds optional `pulse_age_minutes` (number|null).
4. Observe-only — no orders; never invent book numbers. Check lives in cron/`runWatch`, not ingestBookPulse (pulse path is fresh).
5. Package **1.6.5**. Version `ff074668-8603-4c30-925c-27bc55b2002c`. Auth: CLOUDFLARE_API_TOKEN unset; OAuth; nvm 22.
6. Prove: GET /health pulse_age_minutes present; POST /admin/run-check drift=false alertId=null (fresh last_pulse_ts); last_alert_ts unchanged.

### Do not retry
- Do not false-fire pulse_stale on bootstrap (never-pulsed).
- Do not check pulse freshness inside ingestBookPulse.
- Do not invent soft_cap_util_pct / book numbers; no orders/HMAC; no CLOUDFLARE_API_TOKEN while OAuth works.

## 2026-09-08 wealth filter — cron demotion + DRIFT_PCT (1.6.6)

### Spec shipped
1. Demoted night-school and dreaming crons; triggers.crons = only `*/15 * * * *`.
2. `DRIFT_PCT` 5→8 to cut tape noise.
3. Package **1.6.6**. Version `c5a77fea-b18d-4121-8fde-9e7a23cb051d`. Auth: CLOUDFLARE_API_TOKEN unset; OAuth; nvm 22. Cron list from deploy: `*/15 * * * *` only; DRIFT_PCT binding "8".
4. Receipt: `/workspace/jarvis-os/_ops/watchman/evidence/receipt-2026-09-08-wealth-filter-crons.txt`.

### Do not retry
- Do not re-add night-school/dreaming crons without an explicit wealth-filter revisit.
- Do not set CLOUDFLARE_API_TOKEN while OAuth works; no orders/HMAC; never print secrets.
