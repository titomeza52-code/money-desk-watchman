| pid | kind | path | license | provenance | status |
|---|---|---|---|---|---|
| jarvis:money-desk-watchman:worker | cloudflare-worker | /workspace/projects/money-desk-watchman | internal | Miguel YES book-pulse 2026-09-07 | live workers.dev v9e380213; OAuth; ARTIFACTS→ego-artifacts; book-pulse+fills+predict-clip |
| jarvis:money-desk-watchman:d1 | d1-database | money-desk-watchman-db / 640e8406-f3b6-4a00-beb1-3ad05ceb92d9 | internal | wrangler d1 create via OAuth | live bound as DB |
| jarvis:money-desk-watchman:cron-15m | cron | */15 * * * * UTC | internal | wrangler triggers | live |
| jarvis:money-desk-watchman:cron-night | cron | 15 10 * * * UTC (03:15 PT) | internal | night-school | live |
| jarvis:money-desk-watchman:cron-dream | cron | 0 10 * * SUN UTC (03:00 PT Sun) | internal | Phase4 dreaming — CF Quartz SUN not 0 | live |
| jarvis:money-desk-watchman:admin | secret | ADMIN_TOKEN via wrangler secret + .dev.vars | internal | generated locally mode 600 | set on CF + local |
| jarvis:money-desk-watchman:r2 | r2-bucket | ego-artifacts | internal | Phase2 create+bind; Phase4 dreaming/ + night-school/ | live ARTIFACTS; health r2_ok |
| jarvis:money-desk-watchman:lessons | notes | LESSONS.md | internal | Phase4 + book-pulse research bake-in | usable |
| jarvis:money-desk-watchman:disk-mirror | ops-json | /workspace/jarvis-os/_ops/watchman/last.json | internal | post-run verify | updated book-pulse 2026-09-07 |
| jarvis:money-desk-watchman:parked-open-order-stale | parked | needs READ-ONLY Coinbase key | internal | L3 public-only | parked — stale_watch gap detector only |
| jarvis:money-desk-watchman:book-pulse | admin-route | POST /admin/book-pulse | internal | Desk/box feeder observe-only | live; requires as_of; 400 as_of_stale/missing/invalid/future; R2 pulses/; alerts mark≤118 sleeve≤-4 |
| jarvis:money-desk-watchman:health-wake | health-contract | GET /health | internal | Desk pull 1.6.7 | pulse_stale + wake.needed/reason; no GET side effects |
| jarvis:money-desk-watchman:fill-receipt | admin-route | POST /admin/fill-receipt | internal | sanitized fills → R2 | live fills/YYYY-MM-DD/ |
| jarvis:money-desk-watchman:soft-cap-flag | d1-state | soft_cap_flag via util>25 | internal | Coinbase/Usage observe | live /health + /admin/flags |
| jarvis:money-desk-watchman:feeder | box-script | scripts/push-book-pulse.py | internal | reads jarvis-hud/live.json | usable; dark: predict_sleeve_net, soft_cap_util_pct |
| jarvis:money-desk-watchman:parked-ae-vectorize-pages | parked | Analytics Engine / Vectorize / Pages / Worker RO CB key | internal | research park | parked |
| jarvis:money-desk-watchman:predict-clip | admin-route | POST /admin/predict-clip | internal | Coinbase PRIORITY cash-out observe | live; R2 predicts/; health predict_clip_open/cash_out_alert_armed |
