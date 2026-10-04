/**
 * money-desk-watchman — L3 edge watchman (public market data only).
 * NEVER places/cancels/modifies orders. No Coinbase account keys.
 * Leo / couple-inbox / partner-key paths: DEAD — do not wake those chats.
 * Discord flag posts mention Hermes only. They are not orders.
 */

import { buildDiscordFlagMessage } from "./discord-flag";
import {
  buildBookPulseHermesFlag,
  buildPredictCashOutHermesFlag,
  buildPulseStaleHermesFlag,
  wreckDistances,
} from "./hermes-flag";
import {
  PULSE_STALE_MINUTES_DEFAULT,
  deskFeederWakeContract,
  evaluatePulseAsOf,
  evaluatePulseFreshness,
  type DeskFeederWake,
  type PulseFreshness,
} from "./pulse-contract";

export interface Env {
  DB?: D1Database;
  ADMIN_TOKEN: string;
  DRIFT_PCT?: string;
  WORKER_NAME?: string;
  BOOK_MARK_USD?: string;
  ARTIFACTS?: R2Bucket;
  /** Optional Desk wake URL — POST only if set; never HMAC; skip if absent. */
  COINBASE_WAKE_URL?: string;
  /**
   * Secret. Discord webhook for the Hermes room. Not committed.
   * wrangler secret put DISCORD_WEBHOOK_URL
   */
  DISCORD_WEBHOOK_URL?: string;
  /** Optional Hermes bot snowflake so the message is a real mention. Not a token. */
  HERMES_DISCORD_USER_ID?: string;
}

function requireDb(env: Env): D1Database {
  if (!env.DB) {
    throw new Error("D1 binding DB missing — park until Account D1 Edit + wrangler d1 create");
  }
  return env.DB;
}

type Policy = {
  id: number;
  soft_cap_usd: number;
  max_open_orders: number;
  stale_order_minutes: number;
  alert_cooldown_minutes: number;
  alerts_enabled: number;
  /** Desk feeder dead threshold; default 45. */
  pulse_stale_minutes: number;
  updated_at: string;
};

type Ticker = { product: string; price: number; bid?: number; ask?: number; raw: unknown };

const PRODUCTS = ["BTC-USD", "ETH-USD"] as const;
const COINBASE_BASE = "https://api.exchange.coinbase.com";
const DEFAULT_BOOK_MARK_USD = 130;
/** Desk feeder dead: last_pulse_ts older than this → pulse_stale (observe-only). */
const PULSE_STALE_MINUTES = PULSE_STALE_MINUTES_DEFAULT;

async function migrate(env: Env): Promise<void> {
  const db = requireDb(env);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS policy (
      id INTEGER PRIMARY KEY CHECK (id=1),
      soft_cap_usd REAL NOT NULL DEFAULT 150,
      max_open_orders INTEGER NOT NULL DEFAULT 5,
      stale_order_minutes INTEGER NOT NULL DEFAULT 120,
      alert_cooldown_minutes INTEGER NOT NULL DEFAULT 60,
      alerts_enabled INTEGER NOT NULL DEFAULT 1,
      pulse_stale_minutes INTEGER NOT NULL DEFAULT 45,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      ok INTEGER NOT NULL,
      drift INTEGER NOT NULL,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      sent INTEGER NOT NULL,
      cooldown_until TEXT,
      dedup_hash TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      source TEXT NOT NULL,
      rule TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS artifacts_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      r2_key TEXT,
      kind TEXT NOT NULL,
      notes TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS state (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedup ON alerts(dedup_hash) WHERE dedup_hash IS NOT NULL`
    ),
  ]);

  const row = await db.prepare("SELECT id FROM policy WHERE id=1").first();
  if (!row) {
    await db
      .prepare(
        `INSERT INTO policy (id, soft_cap_usd, max_open_orders, stale_order_minutes, alert_cooldown_minutes, alerts_enabled, updated_at)
         VALUES (1, 150, 5, 120, 60, 1, ?)`
      )
      .bind(new Date().toISOString())
      .run();
  }

  // Migrate: pulse_stale_minutes on existing policy rows (CREATE IF NOT EXISTS won't add cols)
  try {
    await db
      .prepare(`ALTER TABLE policy ADD COLUMN pulse_stale_minutes INTEGER NOT NULL DEFAULT 45`)
      .run();
  } catch {
    /* column already exists */
  }

    // Seed book_mark_usd in state (no account balances — soft-cap utilization proxy)
  const existingMark = await stateGet(db, "book_mark_usd");
  if (existingMark == null) {
    const seed = Number(env.BOOK_MARK_USD ?? DEFAULT_BOOK_MARK_USD);
    const mark = Number.isFinite(seed) && seed > 0 ? seed : DEFAULT_BOOK_MARK_USD;
    await stateSet(db, "book_mark_usd", String(mark));
  }
}

async function getPolicy(db: D1Database): Promise<Policy> {
  const p = await db.prepare("SELECT * FROM policy WHERE id=1").first<Policy>();
  if (!p) throw new Error("policy missing after migrate");
  const pulseStale =
    typeof p.pulse_stale_minutes === "number" && Number.isFinite(p.pulse_stale_minutes) && p.pulse_stale_minutes > 0
      ? p.pulse_stale_minutes
      : PULSE_STALE_MINUTES;
  return { ...p, pulse_stale_minutes: pulseStale };
}

async function stateGet(db: D1Database, k: string): Promise<string | null> {
  const r = await db.prepare("SELECT v FROM state WHERE k=?").bind(k).first<{ v: string }>();
  return r?.v ?? null;
}

async function stateSet(db: D1Database, k: string, v: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`
    )
    .bind(k, v)
    .run();
}

async function getBookMarkUsd(env: Env, db: D1Database): Promise<number> {
  const raw = await stateGet(db, "book_mark_usd");
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const envN = Number(env.BOOK_MARK_USD ?? DEFAULT_BOOK_MARK_USD);
  return Number.isFinite(envN) && envN > 0 ? envN : DEFAULT_BOOK_MARK_USD;
}

function utilPct(bookMarkUsd: number, softCapUsd: number): number {
  if (!Number.isFinite(softCapUsd) || softCapUsd <= 0) return 0;
  return (bookMarkUsd / softCapUsd) * 100;
}

async function setLastError(db: D1Database, msg: string | null): Promise<void> {
  if (msg == null) {
    await stateSet(db, "last_error", "");
  } else {
    await stateSet(db, "last_error", msg.slice(0, 500));
  }
}

function wakeEnvelope(body: Record<string, unknown>): Record<string, unknown> {
  return {
    source: "money-desk-watchman",
    ...body,
    note: typeof body.note === "string" ? body.note : "observe-only wake; no HMAC; no orders",
  };
}

function redactUrl(msg: string): string {
  return msg.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 180);
}

function isDiscordWebhook(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname === "discord.com" || url.hostname === "discordapp.com") &&
      url.pathname.startsWith("/api/webhooks/")
    );
  } catch {
    return false;
  }
}

/**
 * Deliver an already-built observe-only flag to Hermes (COINBASE_WAKE_URL).
 * The body is sent as-is. No retry, no response parse, no enrichment.
 * Skip if URL absent. Never HMAC. Never an order.
 */
async function postDeskWake(env: Env, body: Record<string, unknown>): Promise<string> {
  if (!env.COINBASE_WAKE_URL) return "skipped_no_url";
  try {
    const wakeRes = await fetch(env.COINBASE_WAKE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(wakeEnvelope(body)),
    });
    return `posted:${wakeRes.status}`;
  } catch (e) {
    return `error:${redactUrl(e instanceof Error ? e.message : String(e))}`;
  }
}

/**
 * Observe-only Discord post of the same flag. Mentions Hermes. Not an order.
 * Starts immediately. No score. Skip if DISCORD_WEBHOOK_URL is unset.
 * Leo / couple-inbox stays dead.
 */
async function postDiscordFlag(env: Env, body: Record<string, unknown>): Promise<string> {
  const hook = env.DISCORD_WEBHOOK_URL?.trim();
  if (!hook) return "skipped_no_discord";
  if (!isDiscordWebhook(hook)) return "skipped_bad_webhook";
  const msg = buildDiscordFlagMessage(wakeEnvelope(body), env.HERMES_DISCORD_USER_ID);
  try {
    let res: Response;
    if (msg.file_body) {
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({ content: msg.content, allowed_mentions: msg.allowed_mentions })
      );
      form.append("files[0]", new Blob([msg.file_body], { type: "application/json" }), "flag.json");
      res = await fetch(hook, { method: "POST", body: form });
    } else {
      res = await fetch(hook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: msg.content, allowed_mentions: msg.allowed_mentions }),
      });
    }
    return `discord:${res.status}`;
  } catch (e) {
    return `discord_error:${redactUrl(e instanceof Error ? e.message : String(e))}`;
  }
}

/** Start URL wake and Discord together. Callers await after the sends are already in flight. */
function startFlagDelivery(
  env: Env,
  flag: Record<string, unknown>,
  opts?: { wake?: boolean }
): { wake: Promise<string>; discord: Promise<string> } {
  return {
    wake: opts?.wake === false ? Promise.resolve("skipped_not_requested") : postDeskWake(env, flag),
    discord: postDiscordFlag(env, flag),
  };
}

async function fetchTicker(product: string): Promise<{ ok: true; ticker: Ticker } | { ok: false; error: string; status?: number }> {
  try {
    const res = await fetch(`${COINBASE_BASE}/products/${product}/ticker`, {
      headers: { Accept: "application/json", "User-Agent": "money-desk-watchman/1.0" },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    }
    const raw = (await res.json()) as { price?: string; bid?: string; ask?: string };
    const price = Number(raw.price);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: "invalid price in ticker", status: res.status };
    }
    return {
      ok: true,
      ticker: {
        product,
        price,
        bid: raw.bid ? Number(raw.bid) : undefined,
        ask: raw.ask ? Number(raw.ask) : undefined,
        raw,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


/** Rate-limit / transient upstream — log + last_transient_error; never alert; may still refresh last_ok when partial. */
function isTransientFetchStatus(status?: number): boolean {
  if (status == null) return false;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

function midFromTickers(tickers: Ticker[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tickers) {
    if (t.bid && t.ask && Number.isFinite(t.bid) && Number.isFinite(t.ask)) {
      out[t.product] = (t.bid + t.ask) / 2;
    } else {
      out[t.product] = t.price;
    }
  }
  return out;
}

async function dedupHash(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("|"));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

type DriftReason = {
  kind: string;
  detail: string;
  product?: string;
  last?: number;
  now?: number;
  pct?: number;
};

/**
 * Enforce: same drift fingerprint within cooldown must not double-insert.
 * Free unique-index slot after cooldown so a later identical drift can re-alert.
 */
async function tryInsertAlert(
  db: D1Database,
  opts: {
    ts: string;
    kind: string;
    body: string;
    hash: string;
    cooldownUntil: string;
  }
): Promise<{ alertId: number | null; deduped: boolean }> {
  const { ts, kind, body, hash, cooldownUntil } = opts;

  // Free expired fingerprints so unique index allows a later re-alert
  await db
    .prepare(
      `UPDATE alerts SET dedup_hash = NULL
       WHERE dedup_hash = ? AND cooldown_until IS NOT NULL AND cooldown_until < ?`
    )
    .bind(hash, ts)
    .run();

  const existing = await db
    .prepare(
      `SELECT id FROM alerts
       WHERE dedup_hash = ?
         AND (cooldown_until IS NULL OR cooldown_until >= ?)
       LIMIT 1`
    )
    .bind(hash, ts)
    .first<{ id: number }>();

  if (existing) {
    return { alertId: null, deduped: true };
  }

  const globalCooldown = await stateGet(db, "alert_cooldown_until");
  if (globalCooldown && globalCooldown > ts) {
    return { alertId: null, deduped: true };
  }

  try {
    const a = await db
      .prepare(
        `INSERT INTO alerts (ts, kind, body, sent, cooldown_until, dedup_hash) VALUES (?, ?, ?, 0, ?, ?) RETURNING id`
      )
      .bind(ts, kind, body, cooldownUntil, hash)
      .first<{ id: number }>();
    return { alertId: a?.id ?? null, deduped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Unique index race / conflict → treat as deduped
    if (/UNIQUE|constraint|dedup/i.test(msg)) {
      return { alertId: null, deduped: true };
    }
    throw e;
  }
}

async function runWatch(
  env: Env,
  source: string,
  opts?: { forceAlert?: boolean; forceThresholdPct?: number }
): Promise<{
  ok: boolean;
  drift: boolean;
  checkId?: number;
  alertId?: number | null;
  deduped?: boolean;
  silenced?: boolean;
  util_pct?: number;
  payload: unknown;
}> {
  await migrate(env);
  const db = requireDb(env);
  const policy = await getPolicy(db);
  const ts = new Date().toISOString();
  const driftPct = opts?.forceThresholdPct ?? Number(env.DRIFT_PCT ?? "5");
  const bookMarkUsd = await getBookMarkUsd(env, db);
  const util = utilPct(bookMarkUsd, policy.soft_cap_usd);

  const results = await Promise.all(PRODUCTS.map((p) => fetchTicker(p)));
  const tickers: Ticker[] = [];
  const reasons: DriftReason[] = [];
  const fetch_errors: { product: string; error: string; status?: number; transient: boolean }[] = [];
  let fetchOk = true;

  for (let i = 0; i < PRODUCTS.length; i++) {
    const product = PRODUCTS[i];
    const r = results[i];
    if (!r.ok) {
      fetchOk = false;
      const transient = isTransientFetchStatus(r.status);
      fetch_errors.push({
        product,
        error: r.error,
        status: r.status,
        transient,
      });
      // Hard failures still count as drift/alert; 429/5xx are logged only
      if (!transient) {
        reasons.push({ kind: "fetch_failure", detail: `${product}: ${r.error}`, product });
      }
    } else {
      tickers.push(r.ticker);
    }
  }

  // Stale-check detector (NOT real open-order stale — that needs READ-ONLY Coinbase key, parked)
  const lastOkTs = await stateGet(db, "last_ok_check_ts");
  let last_ok_age_minutes: number | null = null;
  if (lastOkTs) {
    const ageMs = Date.now() - Date.parse(lastOkTs);
    const staleMs = policy.stale_order_minutes * 60_000;
    if (Number.isFinite(ageMs)) {
      last_ok_age_minutes = Number((ageMs / 60_000).toFixed(2));
      if (ageMs > staleMs) {
        const ageMin = (ageMs / 60_000).toFixed(1);
        reasons.push({
          kind: "stale_watch",
          detail: `last successful check ${ageMin}m ago > policy.stale_order_minutes=${policy.stale_order_minutes} (watchman outage gap; not open-order stale)`,
        });
      }
    }
  }

  // Desk feeder dead: last_pulse_ts set and older than pulse_stale_minutes (no bootstrap false-fire)
  const lastPulseTs = await stateGet(db, "last_pulse_ts");
  const pulseFreshness = evaluatePulseFreshness(lastPulseTs, Date.now(), policy.pulse_stale_minutes);
  if (pulseFreshness.pulse_stale) {
    const ageMin = pulseFreshness.pulse_age_minutes ?? 0;
    reasons.push({
      kind: "pulse_stale",
      detail: `Desk feeder last_pulse_ts age ${ageMin}m > policy.pulse_stale_minutes=${policy.pulse_stale_minutes} (feeder dead; observe-only)`,
    });
  }

  const mids = midFromTickers(tickers);
  const lastMidsRaw = await stateGet(db, "last_mids_json");
  let lastMids: Record<string, number> = {};
  if (lastMidsRaw) {
    try {
      lastMids = JSON.parse(lastMidsRaw) as Record<string, number>;
    } catch {
      lastMids = {};
    }
  }

  const hardFetchFail = fetch_errors.some((e) => e.transient === false);
  const transientOnly = fetch_errors.length > 0 && !hardFetchFail;
  const partialOk = tickers.length > 0;
  const price_moves: { product: string; last: number; now: number; pct: number; above_threshold: boolean }[] = [];

  // Compare mids for products present in both lastMids and current mids (partial OK).
  // Keep every compared move, including those under the drift threshold. Same loop; no second pass.
  if (partialOk) {
    for (const [product, mid] of Object.entries(mids)) {
      const last = lastMids[product];
      if (typeof last === "number" && last > 0) {
        const pct = Math.abs((mid - last) / last) * 100;
        const above = pct > driftPct;
        price_moves.push({ product, last, now: mid, pct, above_threshold: above });
        if (above) {
          reasons.push({
            kind: "price_move",
            detail: `${product} mid moved ${pct.toFixed(2)}% (threshold ${driftPct}%)`,
            product,
            last,
            now: mid,
            pct,
          });
        }
      }
    }
  }

  if (opts?.forceAlert) {
    reasons.push({
      kind: "forced_test",
      detail: "admin force-alert: synthetic drift for pipeline test (no market action)",
    });
  }

  const drifted = reasons.length > 0;
  const payload = {
    ts,
    source,
    drift_pct_threshold: driftPct,
    tickers: tickers.map((t) => ({
      product: t.product,
      price: t.price,
      bid: t.bid,
      ask: t.ask,
      mid: mids[t.product],
    })),
    last_mids: lastMids,
    fetch_errors,
    reasons,
    book_mark_usd: bookMarkUsd,
    soft_cap_usd: policy.soft_cap_usd,
    util_pct: Number(util.toFixed(2)),
    policy_snapshot: {
      soft_cap_usd: policy.soft_cap_usd,
      max_open_orders: policy.max_open_orders,
      alerts_enabled: policy.alerts_enabled,
      alert_cooldown_minutes: policy.alert_cooldown_minutes,
      stale_order_minutes: policy.stale_order_minutes,
      pulse_stale_minutes: policy.pulse_stale_minutes,
      book_mark_usd: bookMarkUsd,
      util_pct: Number(util.toFixed(2)),
    },
    note: "L3 watchman — observe only; no order placement/cancel/modify",
  };

  const ins = await db
    .prepare(`INSERT INTO checks (ts, ok, drift, source, payload_json) VALUES (?, ?, ?, ?, ?) RETURNING id`)
    .bind(ts, fetchOk ? 1 : 0, drifted ? 1 : 0, source, JSON.stringify(payload))
    .first<{ id: number }>();

  await stateSet(db, "last_check_ts", ts);
  // checks.ok stays strict (all products); last_ok_check_ts refreshes on partialOk && !hardFetchFail
  // so sticky public 429s do not age into stale_watch after Miguel's 429 mute.
  if (partialOk && !hardFetchFail) {
    await stateSet(db, "last_ok_check_ts", ts);
    if (Object.keys(mids).length) {
      const mergedMids = { ...lastMids, ...mids };
      await stateSet(db, "last_mids_json", JSON.stringify(mergedMids));
    }
    await setLastError(db, null);
    if (transientOnly) {
      const tDetail = fetch_errors.map((e) => `${e.product}: ${e.error}`).join("; ");
      await stateSet(db, "last_transient_error", tDetail.slice(0, 500));
    } else {
      await stateSet(db, "last_transient_error", "");
    }
  } else {
    const failDetail =
      fetch_errors.map((e) => `${e.product}: ${e.error}`).join("; ") ||
      reasons
        .filter((r) => r.kind === "fetch_failure")
        .map((r) => r.detail)
        .join("; ");
    await setLastError(db, failDetail || "fetch_failure");
    // do NOT bump last_ok_check_ts on hard fail or zero tickers
  }

  let alertId: number | null = null;
  let deduped = false;
  let silenced = false;

  // Kill-switch: alerts_enabled=0 silences posts but checks already written above
  if (drifted) {
    if (policy.alerts_enabled !== 1) {
      silenced = true;
    } else {
      const kind = reasons.map((r) => r.kind).sort().join("+") || "drift";
      // Fingerprint WITHOUT time bucket — cooldown gate + unique index enforce no double-insert
      const hash = await dedupHash([
        kind,
        ...reasons.map((r) => `${r.kind}:${r.product ?? ""}:${r.detail.slice(0, 80)}`),
      ]);

      const lines: string[] = [
        "Money Desk Watchman — DRIFT (observe-only)",
        `When: ${ts}`,
        `Source: ${source}`,
        `util_pct=${util.toFixed(1)} (book_mark_usd=${bookMarkUsd} / soft_cap_usd=${policy.soft_cap_usd})`,
        "",
        "What drifted:",
      ];
      for (const r of reasons) {
        lines.push(`- [${r.kind}] ${r.detail}`);
        if (r.last != null && r.now != null) {
          lines.push(`  last-good mid=${r.last} → now=${r.now} (${r.pct?.toFixed(2)}%)`);
        }
      }
      lines.push("");
      lines.push("Ticker snapshot:");
      for (const t of payload.tickers) {
        lines.push(`- ${t.product}: price=${t.price} mid=${t.mid}`);
      }
      if (Object.keys(lastMids).length) {
        lines.push("");
        lines.push("Last-good mids: " + JSON.stringify(lastMids));
      }
      lines.push("");
      lines.push("Recommended human action:");
      lines.push("- Review public tape vs your desk soft-cap policy on disk.");
      lines.push("- If intentional move: acknowledge and leave alone.");
      lines.push("- If unexpected: investigate connectivity / desk notes — do NOT auto-trade from this alert.");
      lines.push("- No executable order instructions are included (L3).");

      const body = lines.join("\n");
      const until = new Date(Date.now() + policy.alert_cooldown_minutes * 60_000).toISOString();

      const inserted = await tryInsertAlert(db, {
        ts,
        kind,
        body,
        hash,
        cooldownUntil: until,
      });
      alertId = inserted.alertId;
      deduped = inserted.deduped;
      if (alertId != null) {
        const delivery = startFlagDelivery(
          env,
          buildPulseStaleHermesFlag({
            ts,
            check_id: ins?.id,
            alert_id: alertId,
            check_source: source,
            drift: drifted,
            drift_pct_threshold: driftPct,
            tickers: payload.tickers,
            last_mids: lastMids,
            fetch_errors,
            reasons,
            book_mark_usd: bookMarkUsd,
            soft_cap_usd: policy.soft_cap_usd,
            util_pct: payload.util_pct,
            last_pulse_ts: lastPulseTs,
            pulse_age_minutes: pulseFreshness.pulse_age_minutes,
            pulse_stale: pulseFreshness.pulse_stale,
            pulse_stale_minutes: policy.pulse_stale_minutes,
            never_pulsed: pulseFreshness.never_pulsed,
            last_ok_check_ts: lastOkTs,
            last_ok_age_minutes,
            fetch_ok: fetchOk,
            partial_ok: partialOk,
            hard_fetch_fail: hardFetchFail,
            transient_only: transientOnly,
            price_moves,
            policy_snapshot: payload.policy_snapshot,
            alert_kind: reasons.some((r) => r.kind === "pulse_stale") ? "pulse_stale" : kind,
          }),
          { wake: reasons.some((r) => r.kind === "pulse_stale") }
        );
        await stateSet(db, "alert_cooldown_until", until);
        await stateSet(db, "last_alert_ts", ts);
        await Promise.all([delivery.wake, delivery.discord]);
      }
      // Leo bridge stays dead. Discord is the Hermes mention only.
    }
  }

  return {
    ok: fetchOk,
    drift: drifted,
    checkId: ins?.id,
    alertId,
    deduped,
    silenced,
    util_pct: Number(util.toFixed(2)),
    payload,
  };
}

async function runNightSchool(env: Env): Promise<{ lessons: number; r2: string }> {
  await migrate(env);
  const db = requireDb(env);
  const ts = new Date().toISOString();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const checks = await db
    .prepare(`SELECT id, ts, ok, drift, source FROM checks WHERE ts >= ? ORDER BY id DESC LIMIT 200`)
    .bind(since)
    .all();
  const alerts = await db
    .prepare(`SELECT id, ts, kind FROM alerts WHERE ts >= ? ORDER BY id DESC LIMIT 50`)
    .bind(since)
    .all();

  const checkRows = checks.results ?? [];
  const alertRows = alerts.results ?? [];
  const failN = checkRows.filter((c) => Number(c.ok) === 0).length;
  const driftN = checkRows.filter((c) => Number(c.drift) === 1).length;

  const proposals: { rule: string; evidence: string }[] = [];
  proposals.push({
    rule: "Keep Coinbase ticker fetch unauthenticated; HTTP 429/5xx → last_error + checks only (no alert); hard fetch fail / price drift alert; never trade signal.",
    evidence: `last24h checks=${checkRows.length} fetch_fail=${failN}`,
  });
  proposals.push({
    rule: "Price-move drift is soft-cap style observation only; humans decide — worker must not place/cancel/modify.",
    evidence: `last24h drift_checks=${driftN} alerts=${alertRows.length}`,
  });
  if (failN > 0) {
    proposals.push({
      rule: "On repeated Coinbase fetch failures, check DNS/egress before changing thresholds.",
      evidence: `fetch_fail=${failN} in 24h`,
    });
  }
  if (alertRows.length === 0) {
    proposals.push({
      rule: "Quiet nights are success: empty alerts with healthy checks means threshold/cooldown working.",
      evidence: `alerts=0 checks=${checkRows.length}`,
    });
  } else {
    proposals.push({
      rule: "Dedup+cooldown prevented alert storms; keep fingerprint dedup + policy.alert_cooldown_minutes.",
      evidence: `alerts=${alertRows.length} kinds=${alertRows.map((a) => a.kind).join(",")}`,
    });
  }
  proposals.push({
    rule: "Leo/couple-inbox is dead — night-school writes D1 lessons only; never wake chat bridges.",
    evidence: "source=night-school; chat wake skipped",
  });
  proposals.push({
    rule: "util_pct = book_mark_usd/soft_cap_usd*100 is a soft-cap proxy — not live account balances.",
    evidence: "no Coinbase account keys (L3)",
  });
  proposals.push({
    rule: "stale_watch flags watchman outage gaps; real open-order stale needs READ-ONLY Coinbase key (parked).",
    evidence: "policy.stale_order_minutes vs last_ok_check_ts",
  });
  proposals.push({
    rule: "pulse_stale fires from runWatch when last_pulse_ts is set and older than pulse_stale_minutes (default 45); bootstrap null skips; never invent book numbers.",
    evidence: "policy.pulse_stale_minutes vs last_pulse_ts",
  });
  proposals.push({
    rule: "ADMIN_TOKEN force-alert is for pipeline tests; kill-switch alerts_enabled=0 silences posts, checks continue.",
    evidence: "POST /admin/force-alert; POST /admin/alerts-enabled",
  });

  const limited = proposals.slice(0, 7);
  let written = 0;
  for (const p of limited) {
    await db
      .prepare(`INSERT INTO lessons (ts, source, rule, evidence, status) VALUES (?, 'night-school', ?, ?, 'proposed')`)
      .bind(ts, p.rule, p.evidence)
      .run();
    written++;
  }

  let r2status = "parked_unbound";
  const day = ts.slice(0, 10);
  const md = [
    `# Night school ${day}`,
    "",
    `Generated: ${ts}`,
    `Checks(24h): ${checkRows.length} fail=${failN} drift=${driftN}`,
    `Alerts(24h): ${alertRows.length}`,
    "",
    "## Proposed lessons",
    ...limited.map((p, i) => `${i + 1}. ${p.rule}\n   evidence: ${p.evidence}`),
    "",
    "Chat wake: skipped (Leo bridge dead).",
  ].join("\n");

  if (env.ARTIFACTS) {
    const key = `night-school/${day}.md`;
    try {
      await env.ARTIFACTS.put(key, md, { httpMetadata: { contentType: "text/markdown" } });
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, ?, 'night-school', 'written')`)
        .bind(ts, key)
        .run();
      r2status = `ok:${key}`;
    } catch (e) {
      r2status = `parked_error:${e instanceof Error ? e.message : String(e)}`;
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'night-school', ?)`)
        .bind(ts, r2status)
        .run();
    }
  } else {
    await db
      .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'night-school', 'R2 unbound — D1 only')`)
      .bind(ts)
      .run();
  }

  return { lessons: written, r2: r2status };
}

/** Sunday dreaming: cluster last 7d lessons; archive duplicate rule text; write R2 summary. No chat wake. */
async function runDreaming(env: Env): Promise<{
  scanned: number;
  kept: number;
  archived: number;
  clusters: number;
  r2: string;
  day: string;
}> {
  await migrate(env);
  const db = requireDb(env);
  const ts = new Date().toISOString();
  const day = ts.slice(0, 10);
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  const rows = await db
    .prepare(
      `SELECT id, ts, source, rule, evidence, status FROM lessons
       WHERE ts >= ? AND status IN ('proposed', 'canonical')
       ORDER BY id ASC`
    )
    .bind(since)
    .all<{ id: number; ts: string; source: string; rule: string; evidence: string; status: string }>();

  const lessons = rows.results ?? [];
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

  type Cluster = {
    key: string;
    canonicalId: number;
    canonicalRule: string;
    members: typeof lessons;
  };
  const clusters = new Map<string, Cluster>();

  for (const L of lessons) {
    const key = norm(L.rule);
    const c = clusters.get(key);
    if (!c) {
      clusters.set(key, {
        key,
        canonicalId: L.id,
        canonicalRule: L.rule,
        members: [L],
      });
    } else {
      c.members.push(L);
      // Prefer canonical status, else oldest id as keeper
      if (L.status === "canonical" && c.members.find((m) => m.id === c.canonicalId)?.status !== "canonical") {
        c.canonicalId = L.id;
        c.canonicalRule = L.rule;
      }
    }
  }

  let archived = 0;
  let kept = 0;
  const summaryLines: string[] = [
    `# Dreaming cycle ${day}`,
    "",
    `Generated: ${ts}`,
    `Window: last 7 days since ${since}`,
    `Scanned lessons: ${lessons.length}`,
    `Clusters (unique rule text): ${clusters.size}`,
    "",
    "## Clusters",
  ];

  for (const c of clusters.values()) {
    const keeper = c.members.find((m) => m.id === c.canonicalId) ?? c.members[0];
    kept++;
    // Ensure keeper is proposed or canonical (not archived)
    if (keeper.status === "proposed") {
      // leave as proposed (canonical reserved for human promote); dreaming keeps one proposed
    }
    const dupes = c.members.filter((m) => m.id !== keeper.id);
    for (const d of dupes) {
      await db.prepare(`UPDATE lessons SET status='archived' WHERE id=?`).bind(d.id).run();
      archived++;
    }
    summaryLines.push("");
    summaryLines.push(`### ${keeper.rule}`);
    summaryLines.push(`- keep id=${keeper.id} status=${keeper.status} ts=${keeper.ts}`);
    summaryLines.push(`- evidence: ${keeper.evidence}`);
    if (dupes.length) {
      summaryLines.push(`- archived duplicates: ${dupes.map((d) => d.id).join(", ")}`);
    } else {
      summaryLines.push("- archived duplicates: none");
    }
  }

  summaryLines.push("");
  summaryLines.push("## Notes");
  summaryLines.push("- D1 updated for lesson status only; no chat/Grok wake.");
  summaryLines.push("- Leo/couple-inbox bridge remains dead.");
  summaryLines.push(`- archived=${archived} kept=${kept}`);

  const md = summaryLines.join("\n");
  let r2status = "parked_unbound";
  const key = `dreaming/${day}.md`;

  if (env.ARTIFACTS) {
    try {
      await env.ARTIFACTS.put(key, md, { httpMetadata: { contentType: "text/markdown" } });
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, ?, 'dreaming', ?)`)
        .bind(ts, key, `clusters=${clusters.size}; archived=${archived}; kept=${kept}`)
        .run();
      r2status = `ok:${key}`;
    } catch (e) {
      r2status = `parked_error:${e instanceof Error ? e.message : String(e)}`;
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'dreaming', ?)`)
        .bind(ts, r2status)
        .run();
    }
  } else {
    await db
      .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'dreaming', ?)`)
      .bind(ts, `R2 unbound; clusters=${clusters.size}; archived=${archived}`)
      .run();
  }

  return {
    scanned: lessons.length,
    kept,
    archived,
    clusters: clusters.size,
    r2: r2status,
    day,
  };
}

function timingIsNightSchool(cron: string | null | undefined): boolean {
  return cron === "15 10 * * *";
}

function timingIsDreaming(cron: string | null | undefined): boolean {
  return cron === "0 10 * * SUN";
}


const BOOK_PULSE_MARK_ALERT_USD = 118;
const BOOK_PULSE_SLEEVE_ALERT = -4;
const BOOK_PULSE_DRY_IDLE_USD = 5;
const SOFT_CAP_FLAG_PCT = 25;

type BookPulse = {
  book_mark_usd: number | null;
  wreck_pause_usd: number;
  wreck_kill_usd: number;
  open_order_count: number | null;
  morpho_usd: number | null;
  dry_usd: number | null;
  predict_sleeve_net: number | null;
  soft_cap_util_pct: number | null;
  /** When true, Morpho USD convert is known-blocked — mute morpho_dry_idle alerts. */
  morpho_convert_blocked?: boolean;
  /** Snapshot time from Desk (ISO-8601); required on POST, stored as last_pulse_ts. */
  as_of?: string;
};

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Accept true/false, 1/0, "1"/"0"; undefined if absent/unparseable. */
function boolOrUndef(v: unknown): boolean | undefined {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  return undefined;
}

function parseBookPulse(body: unknown): { ok: true; pulse: BookPulse } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON object body required" };
  }
  const o = body as Record<string, unknown>;
  const wreckPause = numOrNull(o.wreck_pause_usd);
  const wreckKill = numOrNull(o.wreck_kill_usd);
  const pulse: BookPulse = {
    book_mark_usd: numOrNull(o.book_mark_usd),
    wreck_pause_usd: wreckPause != null ? wreckPause : 113,
    wreck_kill_usd: wreckKill != null ? wreckKill : 92,
    open_order_count: (() => {
      const n = numOrNull(o.open_order_count);
      return n == null ? null : Math.trunc(n);
    })(),
    morpho_usd: numOrNull(o.morpho_usd),
    dry_usd: numOrNull(o.dry_usd),
    predict_sleeve_net: numOrNull(o.predict_sleeve_net),
    soft_cap_util_pct: numOrNull(o.soft_cap_util_pct),
  };
  const blocked = boolOrUndef(o.morpho_convert_blocked);
  if (blocked !== undefined) {
    pulse.morpho_convert_blocked = blocked;
  }
  return { ok: true, pulse };
}

/** Strip secret-like keys recursively; never log secrets. */
function sanitizeFillReceipt(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((x) => sanitizeFillReceipt(x, depth + 1));
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  const secretRe = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|hmac|authorization|bearer|credential|signing)/i;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (secretRe.test(k)) continue;
    out[k] = sanitizeFillReceipt(v, depth + 1);
  }
  return out;
}

async function ingestBookPulse(
  env: Env,
  pulse: BookPulse,
  asOfIso: string,
  snapshotAgeMinutes: number
): Promise<{
  ok: boolean;
  checkId?: number;
  alertId?: number | null;
  deduped?: boolean;
  silenced?: boolean;
  soft_cap_flag: number;
  r2?: string;
  pulse: BookPulse;
  ts: string;
  as_of: string;
  wake?: string;
  discord?: string;
}> {
  await migrate(env);
  const db = requireDb(env);
  const policy = await getPolicy(db);
  const ts = new Date().toISOString();

  // Persist latest pulse fields in state (null → empty string marker)
  const setN = async (k: string, v: number | null) => {
    await stateSet(db, k, v == null ? "" : String(v));
  };
  await setN("book_mark_usd", pulse.book_mark_usd);
  await setN("wreck_pause_usd", pulse.wreck_pause_usd);
  await setN("wreck_kill_usd", pulse.wreck_kill_usd);
  await setN("open_order_count", pulse.open_order_count);
  await setN("morpho_usd", pulse.morpho_usd);
  await setN("dry_usd", pulse.dry_usd);
  await setN("predict_sleeve_net", pulse.predict_sleeve_net);
  await setN("soft_cap_util_pct", pulse.soft_cap_util_pct);
  if (pulse.morpho_convert_blocked === true) {
    await stateSet(db, "morpho_convert_blocked", "1");
  } else if (pulse.morpho_convert_blocked === false) {
    await stateSet(db, "morpho_convert_blocked", "0");
  } else {
    await stateSet(db, "morpho_convert_blocked", "");
  }
  await stateSet(db, "last_pulse_ts", asOfIso);
  await stateSet(db, "last_pulse_ingest_ts", ts);
  await stateSet(db, "last_pulse_json", JSON.stringify({ ...pulse, as_of: asOfIso }));

  let softCapFlag = 0;
  const existingFlag = await stateGet(db, "soft_cap_flag");
  softCapFlag = existingFlag === "1" ? 1 : 0;
  if (pulse.soft_cap_util_pct != null) {
    softCapFlag = pulse.soft_cap_util_pct > SOFT_CAP_FLAG_PCT ? 1 : 0;
    await stateSet(db, "soft_cap_flag", String(softCapFlag));
  }

  const payload = {
    ts,
    as_of: asOfIso,
    source: "book_pulse",
    ...pulse,
    soft_cap_flag: softCapFlag,
    soft_cap_usd: policy.soft_cap_usd,
    note: "L3 observe-only book pulse — no order placement/cancel/modify",
  };

  const ins = await db
    .prepare(`INSERT INTO checks (ts, ok, drift, source, payload_json) VALUES (?, 1, 0, 'book_pulse', ?) RETURNING id`)
    .bind(ts, JSON.stringify(payload))
    .first<{ id: number }>();

  // Alert: mark ≤118 OR sleeve ≤ -4. Flag leaves before the R2 copy.
  const markHit =
    pulse.book_mark_usd != null && pulse.book_mark_usd <= BOOK_PULSE_MARK_ALERT_USD;
  const sleeveHit =
    pulse.predict_sleeve_net != null && pulse.predict_sleeve_net <= BOOK_PULSE_SLEEVE_ALERT;
  const dryIdleHit =
    pulse.morpho_convert_blocked !== true &&
    pulse.dry_usd != null &&
    pulse.morpho_usd != null &&
    pulse.dry_usd >= BOOK_PULSE_DRY_IDLE_USD &&
    pulse.morpho_usd > 0;

  let alertId: number | null = null;
  let deduped = false;
  let silenced = false;
  let wake: string | undefined;
  let discord: string | undefined;

  const dists = wreckDistances(pulse.book_mark_usd, pulse.wreck_pause_usd, pulse.wreck_kill_usd);
  const flagUtil =
    pulse.soft_cap_util_pct != null
      ? pulse.soft_cap_util_pct
      : pulse.book_mark_usd != null
        ? Number(utilPct(pulse.book_mark_usd, policy.soft_cap_usd).toFixed(1))
        : null;
  const bookFlagBase = {
    ts,
    as_of: asOfIso,
    pulse_age_minutes: snapshotAgeMinutes,
    check_id: ins?.id,
    book_mark_usd: pulse.book_mark_usd,
    wreck_pause_usd: pulse.wreck_pause_usd,
    wreck_kill_usd: pulse.wreck_kill_usd,
    distance_to_wreck_pause_usd: dists.distance_to_wreck_pause_usd,
    distance_to_wreck_kill_usd: dists.distance_to_wreck_kill_usd,
    open_order_count: pulse.open_order_count,
    morpho_usd: pulse.morpho_usd,
    dry_usd: pulse.dry_usd,
    predict_sleeve_net: pulse.predict_sleeve_net,
    soft_cap_util_pct: pulse.soft_cap_util_pct,
    soft_cap_flag: softCapFlag,
    soft_cap_usd: policy.soft_cap_usd,
    morpho_convert_blocked: pulse.morpho_convert_blocked,
    util_pct: flagUtil,
    mark_hit: markHit,
    sleeve_hit: sleeveHit,
    dry_idle_hit: dryIdleHit,
  };

  if (markHit || sleeveHit) {
    if (policy.alerts_enabled !== 1) {
      silenced = true;
    } else {
      const kinds: string[] = [];
      if (markHit) kinds.push("book_mark_low");
      if (sleeveHit) kinds.push("sleeve_net_low");
      const kind = kinds.join("+");

      const mark = pulse.book_mark_usd;
      const pause = pulse.wreck_pause_usd;
      const kill = pulse.wreck_kill_usd;
      const distPause = dists.distance_to_wreck_pause_usd;
      const distKill = dists.distance_to_wreck_kill_usd;

      const lines: string[] = [
        "Money Desk Watchman — BOOK PULSE ALERT (observe-only)",
        `When: ${ts}`,
        `Kinds: ${kind}`,
      ];
      if (pulse.soft_cap_util_pct != null) {
        lines.push(`util_pct=${pulse.soft_cap_util_pct} (soft_cap_flag=${softCapFlag})`);
      } else if (mark != null) {
        const util = utilPct(mark, policy.soft_cap_usd);
        lines.push(
          `util_pct=${util.toFixed(1)} (book_mark_usd=${mark} / soft_cap_usd=${policy.soft_cap_usd}; soft_cap_flag=${softCapFlag})`
        );
      }
      lines.push(`book_mark_usd=${mark ?? "null"}`);
      lines.push(`predict_sleeve_net=${pulse.predict_sleeve_net ?? "null"}`);
      lines.push(`wreck_pause_usd=${pause} wreck_kill_usd=${kill}`);
      if (distPause != null) lines.push(`distance_to_wreck_pause_usd=${distPause}`);
      if (distKill != null) lines.push(`distance_to_wreck_kill_usd=${distKill}`);
      lines.push(`open_order_count=${pulse.open_order_count ?? "null"} morpho_usd=${pulse.morpho_usd ?? "null"} dry_usd=${pulse.dry_usd ?? "null"}`);
      lines.push("");
      lines.push("Recommended human action:");
      lines.push("- Review live.json / Desk book vs wreck lines (pause/kill).");
      if (markHit) {
        lines.push("- Mark near or through alert band (≤118): consider pause posture — humans only.");
      }
      if (sleeveHit) {
        lines.push("- Predict sleeve net ≤ -4: review sleeve exposure; no auto-hedge from this Worker.");
      }
      lines.push("- Do NOT place/cancel/modify orders from this alert (L3 observe-only).");
      lines.push("- No executable order instructions are included.");

      const body = lines.join("\n");
      // Fingerprint stable per kind so one alert then silence for cooldown
      const hash = await dedupHash(["book_pulse", kind]);
      const until = new Date(Date.now() + policy.alert_cooldown_minutes * 60_000).toISOString();
      const inserted = await tryInsertAlert(db, {
        ts,
        kind: `book_pulse:${kind}`,
        body,
        hash,
        cooldownUntil: until,
      });
      alertId = inserted.alertId;
      deduped = inserted.deduped;
      if (alertId != null) {
        const delivery = startFlagDelivery(
          env,
          buildBookPulseHermesFlag({
            kind: `book_pulse:${kind}`,
            alert_id: alertId,
            ...bookFlagBase,
          })
        );
        await stateSet(db, "alert_cooldown_until", until);
        await stateSet(db, "last_alert_ts", ts);
        [wake, discord] = await Promise.all([delivery.wake, delivery.discord]);
      }
    }
  }

  // Alert: dry cash idle while Morpho has balance (observe-only idle leak).
  // Skip when Morpho convert is known-blocked (dry USD silo) — still store dry/morpho above.
  if (dryIdleHit) {
    if (policy.alerts_enabled !== 1) {
      silenced = true;
    } else {
      const kind = "morpho_dry_idle";
      const lines: string[] = [
        "Money Desk Watchman — MORPHO DRY IDLE (observe-only)",
        `When: ${ts}`,
        `Kind: ${kind}`,
        `dry_usd=${pulse.dry_usd} morpho_usd=${pulse.morpho_usd}`,
        `book_mark_usd=${pulse.book_mark_usd ?? "null"} open_order_count=${pulse.open_order_count ?? "null"}`,
        "",
        "observe-only idle leak — dry cash sitting while Morpho has balance; Coinbase should park dry → Morpho when convert works.",
        "No orders from Worker.",
        "- Do NOT place/cancel/modify orders from this alert (L3 observe-only).",
      ];
      const body = lines.join("\n");
      const hash = await dedupHash(["book_pulse", kind]);
      const until = new Date(Date.now() + policy.alert_cooldown_minutes * 60_000).toISOString();
      const inserted = await tryInsertAlert(db, {
        ts,
        kind: `book_pulse:${kind}`,
        body,
        hash,
        cooldownUntil: until,
      });
      if (inserted.alertId != null) {
        alertId = inserted.alertId;
        deduped = inserted.deduped;
        const delivery = startFlagDelivery(
          env,
          buildBookPulseHermesFlag({
            kind: `book_pulse:${kind}`,
            alert_id: inserted.alertId,
            ...bookFlagBase,
          })
        );
        await stateSet(db, "alert_cooldown_until", until);
        await stateSet(db, "last_alert_ts", ts);
        [wake, discord] = await Promise.all([delivery.wake, delivery.discord]);
      } else if (alertId == null) {
        deduped = inserted.deduped;
      }
    }
  }

  let r2status = "parked_unbound";
  if (env.ARTIFACTS) {
    const day = ts.slice(0, 10);
    const hhmm = ts.slice(11, 16).replace(":", "");
    const key = `pulses/${day}/${hhmm}.json`;
    try {
      await env.ARTIFACTS.put(key, JSON.stringify(payload, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, ?, 'book_pulse', 'written')`)
        .bind(ts, key)
        .run();
      r2status = `ok:${key}`;
    } catch (e) {
      r2status = `parked_error:${e instanceof Error ? e.message : String(e)}`;
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'book_pulse', ?)`)
        .bind(ts, r2status)
        .run();
    }
  }

  return {
    ok: true,
    checkId: ins?.id,
    alertId,
    deduped,
    silenced,
    soft_cap_flag: softCapFlag,
    r2: r2status,
    pulse: { ...pulse, as_of: asOfIso },
    ts,
    as_of: asOfIso,
    wake,
    discord,
  };
}

async function ingestFillReceipt(
  env: Env,
  body: unknown
): Promise<{ ok: boolean; id: string; r2: string; ts: string }> {
  await migrate(env);
  const db = requireDb(env);
  const ts = new Date().toISOString();
  const sanitized = sanitizeFillReceipt(body);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `fill-${Date.now().toString(36)}`;
  const day = ts.slice(0, 10);
  const key = `fills/${day}/${id}.json`;
  const artifact = {
    id,
    ts,
    source: "fill_receipt",
    receipt: sanitized,
    note: "sanitized fill receipt — secrets stripped; observe-only",
  };

  let r2status = "parked_unbound";
  if (!env.ARTIFACTS) {
    await db
      .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'fill_receipt', ?)`)
      .bind(ts, `R2 unbound; id=${id}`)
      .run();
    return { ok: false, id, r2: r2status, ts };
  }
  try {
    await env.ARTIFACTS.put(key, JSON.stringify(artifact, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
    await db
      .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, ?, 'fill_receipt', ?)`)
      .bind(ts, key, `id=${id}`)
      .run();
    r2status = `ok:${key}`;
  } catch (e) {
    r2status = `parked_error:${e instanceof Error ? e.message : String(e)}`;
    await db
      .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'fill_receipt', ?)`)
      .bind(ts, r2status)
      .run();
    return { ok: false, id, r2: r2status, ts };
  }
  return { ok: true, id, r2: r2status, ts };
}


const CASH_OUT_MARK_FRAC = 0.7;
const CASH_OUT_MARK_FLOOR = 0.5;

type PredictClip = {
  market_id: string;
  side: string;
  contracts: number;
  cost_all_in: number;
  max_payout: number;
  mark_now: number;
  expiry_ts: string;
  fee_exit_est: number | null;
};

function computeMarkUp(clip: PredictClip): number {
  return clip.mark_now * clip.contracts - clip.cost_all_in;
}

function cashOutCriteria(
  clip: PredictClip,
  markUp: number
): {
  max_profit: number;
  cash_out_threshold: number;
  meets_cash_out_frac: boolean;
  meets_cash_out_floor: boolean;
  should_alert: boolean;
} {
  const max_profit = clip.max_payout - clip.cost_all_in;
  const cash_out_threshold = CASH_OUT_MARK_FRAC * max_profit;
  const meets_cash_out_frac = markUp >= cash_out_threshold;
  const meets_cash_out_floor = markUp >= CASH_OUT_MARK_FLOOR;
  return {
    max_profit,
    cash_out_threshold,
    meets_cash_out_frac,
    meets_cash_out_floor,
    should_alert: meets_cash_out_frac && meets_cash_out_floor,
  };
}

function parsePredictClipBody(
  body: unknown
):
  | { ok: true; clear: true }
  | { ok: true; clear: false; clip: PredictClip }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON object body required" };
  }
  const o = body as Record<string, unknown>;
  if (o.clear === true) {
    return { ok: true, clear: true };
  }
  const market_id = typeof o.market_id === "string" ? o.market_id.trim() : "";
  const side = typeof o.side === "string" ? o.side.trim() : "";
  const contracts = numOrNull(o.contracts);
  const cost_all_in = numOrNull(o.cost_all_in);
  const mark_now = numOrNull(o.mark_now);
  let max_payout = numOrNull(o.max_payout);
  const expiry_raw = o.expiry_ts;
  const expiry_ts =
    typeof expiry_raw === "string"
      ? expiry_raw.trim()
      : expiry_raw != null
        ? String(expiry_raw)
        : "";
  if (!market_id) return { ok: false, error: "market_id required" };
  if (!side) return { ok: false, error: "side required" };
  if (contracts == null || contracts <= 0) return { ok: false, error: "contracts must be > 0" };
  if (cost_all_in == null || cost_all_in < 0) return { ok: false, error: "cost_all_in must be >= 0" };
  if (mark_now == null || mark_now < 0) return { ok: false, error: "mark_now (bid for sell) must be >= 0" };
  if (!expiry_ts) return { ok: false, error: "expiry_ts required" };
  if (max_payout == null) {
    // contracts * $1 is ok if passed; default when omitted
    max_payout = contracts * 1;
  }
  if (max_payout < 0) return { ok: false, error: "max_payout must be >= 0" };
  const fee_exit_est = numOrNull(o.fee_exit_est);
  return {
    ok: true,
    clear: false,
    clip: {
      market_id,
      side,
      contracts,
      cost_all_in,
      max_payout,
      mark_now,
      expiry_ts,
      fee_exit_est,
    },
  };
}

async function clearPredictClip(
  env: Env,
  reason: string
): Promise<{ ok: boolean; cleared: true; reason: string; ts: string; r2?: string }> {
  await migrate(env);
  const db = requireDb(env);
  const ts = new Date().toISOString();
  const prevJson = await stateGet(db, "predict_clip_json");
  let prevMarket = "";
  let prevSide = "";
  if (prevJson) {
    try {
      const p = JSON.parse(prevJson) as { market_id?: string; side?: string };
      prevMarket = p.market_id || "";
      prevSide = p.side || "";
    } catch {
      /* ignore */
    }
  }
  await stateSet(db, "predict_clip_json", "");
  await stateSet(db, "predict_clip_open", "0");
  await stateSet(db, "predict_mark_up", "");
  await stateSet(db, "cash_out_alert_fired", "0");
  await stateSet(db, "cash_out_alert_armed", "0");
  await stateSet(db, "predict_clip_cleared_ts", ts);
  await stateSet(db, "predict_clip_clear_reason", reason.slice(0, 200));

  // Free cash-out dedup fingerprint so a future clip can re-alert
  if (prevMarket || prevSide) {
    const hash = await dedupHash(["predict_cash_out", prevMarket, prevSide]);
    await db.prepare(`UPDATE alerts SET dedup_hash = NULL WHERE dedup_hash = ?`).bind(hash).run();
  }

  let r2status = "skipped";
  if (env.ARTIFACTS) {
    const day = ts.slice(0, 10);
    const hhmm = ts.slice(11, 16).replace(":", "");
    const key = `predicts/${day}/${hhmm}-clear.json`;
    try {
      const payload = {
        ts,
        source: "predict_clip_clear",
        reason,
        note: "clip cleared / flat / settle / expiry — observe-only; no orders",
      };
      await env.ARTIFACTS.put(key, JSON.stringify(payload, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, ?, 'predict_clip', ?)`)
        .bind(ts, key, reason.slice(0, 120))
        .run();
      r2status = `ok:${key}`;
    } catch (e) {
      r2status = `parked_error:${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return { ok: true, cleared: true, reason, ts, r2: r2status };
}

/**
 * Observe-only Predict cash-out clip. Never places/cancels orders; never HMAC.
 * Alert ONCE when mark_up >= 0.70*(max_payout-cost_all_in) AND mark_up >= 0.50.
 * Dedup until clear/flat/settle. Optional COINBASE_WAKE_URL webhook (skip if absent).
 */
async function ingestPredictClip(
  env: Env,
  clip: PredictClip
): Promise<{
  ok: boolean;
  cleared?: boolean;
  reason?: string;
  clip?: PredictClip;
  mark_up?: number;
  predict_clip_open: boolean;
  cash_out_alert_armed: boolean;
  alertId?: number | null;
  deduped?: boolean;
  silenced?: boolean;
  wake?: string;
  discord?: string;
  r2?: string;
  checkId?: number;
  ts: string;
}> {
  await migrate(env);
  const db = requireDb(env);
  const policy = await getPolicy(db);
  const ts = new Date().toISOString();

  // Auto-clear on expiry
  const expiryMs = Date.parse(clip.expiry_ts);
  if (Number.isFinite(expiryMs) && expiryMs <= Date.now()) {
    const cleared = await clearPredictClip(env, "expiry");
    return {
      ok: true,
      cleared: true,
      reason: "expiry",
      predict_clip_open: false,
      cash_out_alert_armed: false,
      r2: cleared.r2,
      ts: cleared.ts,
    };
  }

  const mark_up = Number(computeMarkUp(clip).toFixed(6));
  const cashOut = cashOutCriteria(clip, mark_up);
  const should = cashOut.should_alert;

  await stateSet(db, "predict_clip_json", JSON.stringify(clip));
  await stateSet(db, "predict_clip_open", "1");
  await stateSet(db, "predict_mark_up", String(mark_up));
  await stateSet(db, "predict_clip_updated_ts", ts);

  const firedRaw = await stateGet(db, "cash_out_alert_fired");
  let fired = firedRaw === "1";
  // If market/side changed, reset fired so new clip can alert
  const prevJson = await stateGet(db, "predict_clip_prev_identity");
  const identity = `${clip.market_id}|${clip.side}`;
  if (prevJson != null && prevJson !== "" && prevJson !== identity) {
    fired = false;
    await stateSet(db, "cash_out_alert_fired", "0");
    const oldParts = prevJson.split("|");
    if (oldParts.length >= 2) {
      const oldHash = await dedupHash(["predict_cash_out", oldParts[0], oldParts[1]]);
      await db.prepare(`UPDATE alerts SET dedup_hash = NULL WHERE dedup_hash = ?`).bind(oldHash).run();
    }
  }
  await stateSet(db, "predict_clip_prev_identity", identity);

  const armed = !fired; // watching until first fire; stays disarmed until clear
  await stateSet(db, "cash_out_alert_armed", armed ? "1" : "0");

  const payload = {
    ts,
    source: "predict_clip",
    ...clip,
    mark_up,
    cash_out_threshold_frac: CASH_OUT_MARK_FRAC,
    cash_out_floor: CASH_OUT_MARK_FLOOR,
    should_alert: should,
    note: "L3 observe-only predict cash-out — no order placement/cancel/modify; never HMAC",
  };

  const ins = await db
    .prepare(
      `INSERT INTO checks (ts, ok, drift, source, payload_json) VALUES (?, 1, 0, 'predict_clip', ?) RETURNING id`
    )
    .bind(ts, JSON.stringify(payload))
    .first<{ id: number }>();

  let alertId: number | null = null;
  let deduped = false;
  let silenced = false;
  let wake = "skipped_no_url";
  let discord = "skipped_no_discord";
  let wakeDelivery: Promise<string> | null = null;
  let discordDelivery: Promise<string> | null = null;

  if (should) {
    if (policy.alerts_enabled !== 1) {
      silenced = true;
    } else if (fired) {
      deduped = true;
    } else {
      const maxProfit = cashOut.max_profit;
      const thresh = cashOut.cash_out_threshold;
      const lines: string[] = [
        "Money Desk Watchman — PREDICT CASH-OUT OBSERVE ALERT",
        `When: ${ts}`,
        `market_id=${clip.market_id} side=${clip.side}`,
        `contracts=${clip.contracts} cost_all_in=${clip.cost_all_in} max_payout=${clip.max_payout}`,
        `mark_now=${clip.mark_now} (bid for sell) mark_up=${mark_up}`,
        `threshold=max(0.70*(max_payout-cost)=${thresh.toFixed(4)}, floor=${CASH_OUT_MARK_FLOOR})`,
        `expiry_ts=${clip.expiry_ts}`,
      ];
      if (clip.fee_exit_est != null) lines.push(`fee_exit_est=${clip.fee_exit_est}`);
      lines.push("");
      lines.push("Recommended human action:");
      lines.push("- Review Predict position for voluntary cash-out (human only).");
      lines.push("- Do NOT place/cancel/modify orders from this alert (L3 observe-only).");
      lines.push("- Never HMAC / never trade from this Worker.");
      lines.push("- Dedup until flat/settle — POST {\"clear\":true} when done.");

      const body = lines.join("\n");
      // Clip-scoped dedup until clear (cooldown_until = expiry or +7d)
      const hash = await dedupHash(["predict_cash_out", clip.market_id, clip.side]);
      const coolMs = Number.isFinite(expiryMs) ? expiryMs : Date.now() + 7 * 86400_000;
      const until = new Date(Math.max(coolMs, Date.now() + 60_000)).toISOString();

      // Free expired fingerprints only; do not use global book-pulse cooldown for cash-out
      await db
        .prepare(
          `UPDATE alerts SET dedup_hash = NULL
           WHERE dedup_hash = ? AND cooldown_until IS NOT NULL AND cooldown_until < ?`
        )
        .bind(hash, ts)
        .run();

      const existing = await db
        .prepare(
          `SELECT id FROM alerts
           WHERE dedup_hash = ?
             AND (cooldown_until IS NULL OR cooldown_until >= ?)
           LIMIT 1`
        )
        .bind(hash, ts)
        .first<{ id: number }>();

      if (existing) {
        deduped = true;
        await stateSet(db, "cash_out_alert_fired", "1");
        await stateSet(db, "cash_out_alert_armed", "0");
        fired = true;
      } else {
        try {
          const a = await db
            .prepare(
              `INSERT INTO alerts (ts, kind, body, sent, cooldown_until, dedup_hash) VALUES (?, ?, ?, 0, ?, ?) RETURNING id`
            )
            .bind(ts, "predict_cash_out", body, until, hash)
            .first<{ id: number }>();
          alertId = a?.id ?? null;
          if (alertId != null) {
            const delivery = startFlagDelivery(
              env,
              buildPredictCashOutHermesFlag({
                ts,
                check_id: ins?.id,
                alert_id: alertId,
                market_id: clip.market_id,
                side: clip.side,
                contracts: clip.contracts,
                cost_all_in: clip.cost_all_in,
                max_payout: clip.max_payout,
                mark_now: clip.mark_now,
                expiry_ts: clip.expiry_ts,
                fee_exit_est: clip.fee_exit_est,
                mark_up,
                max_profit: maxProfit,
                cash_out_threshold: thresh,
                cash_out_threshold_frac: CASH_OUT_MARK_FRAC,
                cash_out_floor: CASH_OUT_MARK_FLOOR,
                should_alert: should,
                meets_cash_out_frac: cashOut.meets_cash_out_frac,
                meets_cash_out_floor: cashOut.meets_cash_out_floor,
              })
            );
            wakeDelivery = delivery.wake;
            discordDelivery = delivery.discord;
            await stateSet(db, "cash_out_alert_fired", "1");
            await stateSet(db, "cash_out_alert_armed", "0");
            await stateSet(db, "last_alert_ts", ts);
            fired = true;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/UNIQUE|constraint|dedup/i.test(msg)) {
            deduped = true;
            await stateSet(db, "cash_out_alert_fired", "1");
            await stateSet(db, "cash_out_alert_armed", "0");
            fired = true;
          } else {
            throw e;
          }
        }
      }

      [wake, discord] = await Promise.all([
        wakeDelivery ?? Promise.resolve(wake),
        discordDelivery ?? Promise.resolve(discord),
      ]);
    }
  }

  const cash_out_alert_armed = !fired;
  await stateSet(db, "cash_out_alert_armed", cash_out_alert_armed ? "1" : "0");

  let r2status = "parked_unbound";
  if (env.ARTIFACTS) {
    const day = ts.slice(0, 10);
    const hhmm = ts.slice(11, 16).replace(":", "");
    const key = `predicts/${day}/${hhmm}.json`;
    try {
      await env.ARTIFACTS.put(key, JSON.stringify(payload, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, ?, 'predict_clip', 'written')`)
        .bind(ts, key)
        .run();
      r2status = `ok:${key}`;
    } catch (e) {
      r2status = `parked_error:${e instanceof Error ? e.message : String(e)}`;
      await db
        .prepare(`INSERT INTO artifacts_index (ts, r2_key, kind, notes) VALUES (?, NULL, 'predict_clip', ?)`)
        .bind(ts, r2status)
        .run();
    }
  }

  return {
    ok: true,
    clip,
    mark_up,
    predict_clip_open: true,
    cash_out_alert_armed,
    alertId,
    deduped,
    silenced,
    wake,
    discord,
    r2: r2status,
    checkId: ins?.id,
    ts,
  };
}


async function stateNum(db: D1Database, k: string): Promise<number | null> {
  const raw = await stateGet(db, k);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}


async function health(env: Env): Promise<Response> {
  let d1_ok = false;
  let r2_ok = false;
  let last_check_ts: string | null = null;
  let last_alert_ts: string | null = null;
  let last_pulse_ts: string | null = null;
  let pulse_age_minutes: number | null = null;
  let alerts_enabled = false;
  let alert_armed = false;
  let last_error: string | null = null;
  let transient_fetch = false;
  let transient_fetch_products: string[] = [];
  let last_transient_error: string | null = null;
  let book_mark_usd: number | null = null;
  let sleeve_net: number | null = null;
  let soft_cap_flag = 0;
  let soft_cap_util_pct: number | null = null;
  let predict_clip_open = false;
  let cash_out_alert_armed = false;
  let predict_mark_up: number | null = null;
  let pulse_stale = false;
  let never_pulsed = false;
  let pulse_stale_minutes: number | null = null;
  let wake: DeskFeederWake = deskFeederWakeContract(
    { last_pulse_ts: null, pulse_age_minutes: null, pulse_stale: false, never_pulsed: false },
    !!env.COINBASE_WAKE_URL
  );
  try {
    await migrate(env);
    const db = requireDb(env);
    d1_ok = true;
    last_check_ts = await stateGet(db, "last_check_ts");
    last_alert_ts = await stateGet(db, "last_alert_ts");
    last_pulse_ts = await stateGet(db, "last_pulse_ts");
    const p = await getPolicy(db);
    pulse_stale_minutes = p.pulse_stale_minutes;
    const freshness: PulseFreshness = evaluatePulseFreshness(
      last_pulse_ts,
      Date.now(),
      p.pulse_stale_minutes
    );
    pulse_age_minutes = freshness.pulse_age_minutes;
    pulse_stale = freshness.pulse_stale;
    never_pulsed = freshness.never_pulsed;
    wake = deskFeederWakeContract(freshness, !!env.COINBASE_WAKE_URL);
    const errRaw = await stateGet(db, "last_error");
    last_error = errRaw && errRaw.length > 0 ? errRaw : null;
    const transientRaw = await stateGet(db, "last_transient_error");
    last_transient_error = transientRaw && transientRaw.length > 0 ? transientRaw : null;
    try {
      const latestCheck = await db
        .prepare(`SELECT payload_json FROM checks ORDER BY id DESC LIMIT 1`)
        .first<{ payload_json: string }>();
      if (latestCheck?.payload_json) {
        const parsed = JSON.parse(latestCheck.payload_json) as {
          fetch_errors?: { product?: string; transient?: boolean }[];
        };
        const errs = Array.isArray(parsed.fetch_errors) ? parsed.fetch_errors : [];
        const transientErrs = errs.filter((e) => e && e.transient === true);
        transient_fetch = transientErrs.length > 0;
        transient_fetch_products = transientErrs
          .map((e) => (typeof e.product === "string" ? e.product : ""))
          .filter((p) => p.length > 0);
      }
    } catch {
      // leave transient_fetch defaults
    }
    alerts_enabled = p.alerts_enabled === 1;
    const cooldownUntil = await stateGet(db, "alert_cooldown_until");
    const nowIso = new Date().toISOString();
    const inCooldown = !!(cooldownUntil && cooldownUntil > nowIso);
    alert_armed = alerts_enabled && !inCooldown;
    book_mark_usd = await stateNum(db, "book_mark_usd");
    sleeve_net = await stateNum(db, "predict_sleeve_net");
    soft_cap_util_pct = await stateNum(db, "soft_cap_util_pct");
    const flagRaw = await stateGet(db, "soft_cap_flag");
    soft_cap_flag = flagRaw === "1" ? 1 : 0;

    // Predict cash-out observe lane
    const clipOpenRaw = await stateGet(db, "predict_clip_open");
    predict_clip_open = clipOpenRaw === "1";
    if (predict_clip_open) {
      const clipJson = await stateGet(db, "predict_clip_json");
      if (clipJson) {
        try {
          const c = JSON.parse(clipJson) as PredictClip;
          const exp = Date.parse(c.expiry_ts);
          if (Number.isFinite(exp) && exp <= Date.now()) {
            await clearPredictClip(env, "expiry_health");
            predict_clip_open = false;
            cash_out_alert_armed = false;
            predict_mark_up = null;
          } else {
            predict_mark_up = await stateNum(db, "predict_mark_up");
            if (predict_mark_up == null) {
              predict_mark_up = Number(computeMarkUp(c).toFixed(6));
            }
            const fired = (await stateGet(db, "cash_out_alert_fired")) === "1";
            cash_out_alert_armed = !fired;
          }
        } catch {
          predict_mark_up = await stateNum(db, "predict_mark_up");
          cash_out_alert_armed = (await stateGet(db, "cash_out_alert_armed")) === "1";
        }
      } else {
        predict_clip_open = false;
      }
    }
  } catch (e) {
    d1_ok = false;
    last_error = e instanceof Error ? e.message : String(e);
  }
  try {
    if (env.ARTIFACTS) {
      await env.ARTIFACTS.head("smoke/__health_probe__");
      r2_ok = true;
    }
  } catch {
    r2_ok = false;
  }
  const body: Record<string, unknown> = {
    ok: d1_ok,
    worker: env.WORKER_NAME || "money-desk-watchman",
    last_check_ts,
    last_alert_ts,
    last_pulse_ts,
    pulse_age_minutes,
    pulse_stale,
    pulse_stale_minutes,
    never_pulsed,
    wake,
    book_mark_usd,
    sleeve_net,
    soft_cap_flag,
    soft_cap_util_pct,
    predict_clip_open,
    cash_out_alert_armed,
    d1_ok,
    r2_ok,
    alerts_enabled,
    alert_armed,
    last_error,
    transient_fetch,
    transient_fetch_products,
    last_transient_error,
  };
  if (predict_mark_up != null) {
    body.predict_mark_up = predict_mark_up;
  }
  return Response.json(body, { status: d1_ok ? 200 : 503 });
}

function landing(): Response {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>money-desk-watchman</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.45}
code{background:#f4f4f4;padding:.1rem .3rem;border-radius:4px}</style></head>
<body>
<h1>money-desk-watchman</h1>
<p>Cloudflare edge watchman for Money Desk soft-cap observation. <strong>L3: observe only</strong> — no order placement, cancel, or modify. Public Coinbase market data only.</p>
<ul>
<li><a href="/health">GET /health</a> — Desk pull: pulse_stale + wake contract (POST /admin/book-pulse when needed)</li>
<li>Cron: every 15m + night-school 10:15 UTC + dreaming Sun 10:00 UTC (0 10 * * SUN)</li>
<li>Alerts stored in D1 (Leo bridge not used)</li>
</ul>
<p>Admin routes require <code>x-admin-token</code> — not for casual use.</p>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function requireAdmin(request: Request, env: Env): boolean {
  const tok =
    request.headers.get("x-admin-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return !!(env.ADMIN_TOKEN && tok === env.ADMIN_TOKEN);
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return health(env);
    }
    if (request.method === "GET" && (path === "/" || path === "")) {
      return landing();
    }

    if (request.method === "POST" && path === "/admin/force-alert") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        const result = await runWatch(env, "admin-force", { forceAlert: true });
        return Response.json({
          ok: true,
          result: {
            ok: result.ok,
            drift: result.drift,
            checkId: result.checkId,
            alertId: result.alertId,
            deduped: result.deduped,
            silenced: result.silenced,
            util_pct: result.util_pct,
          },
        });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e), parked: "D1" },
          { status: 503 }
        );
      }
    }

    if (request.method === "POST" && path === "/admin/run-check") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        const result = await runWatch(env, "admin-run");
        return Response.json({
          ok: true,
          result: {
            ok: result.ok,
            drift: result.drift,
            checkId: result.checkId,
            alertId: result.alertId,
            deduped: result.deduped,
            silenced: result.silenced,
            util_pct: result.util_pct,
            payload: result.payload,
          },
        });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e), parked: "D1" },
          { status: 503 }
        );
      }
    }

    if (request.method === "POST" && path === "/admin/night-school") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        const result = await runNightSchool(env);
        return Response.json({ ok: true, result });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e), parked: "D1" },
          { status: 503 }
        );
      }
    }

    if (request.method === "POST" && path === "/admin/dreaming") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        const result = await runDreaming(env);
        return Response.json({ ok: true, result });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e), parked: "D1" },
          { status: 503 }
        );
      }
    }

    if (request.method === "POST" && path === "/admin/alerts-enabled") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        await migrate(env);
        const db = requireDb(env);
        const rawText = await request.text();
        let val: number | null = null;
        const trimmed = rawText.trim();
        if (trimmed === "0" || trimmed === "1") {
          val = Number(trimmed);
        } else if (trimmed.length) {
          try {
            const body = JSON.parse(trimmed) as unknown;
            if (typeof body === "number" || typeof body === "boolean") {
              val = Number(body) ? 1 : 0;
            } else if (body && typeof body === "object") {
              const o = body as Record<string, unknown>;
              if (o.alerts_enabled != null) val = Number(o.alerts_enabled) ? 1 : 0;
              else if (o.value != null) val = Number(o.value) ? 1 : 0;
              else if (o.enabled != null) val = Number(o.enabled) ? 1 : 0;
            }
          } catch {
            val = null;
          }
        }
        if (val !== 0 && val !== 1) {
          return Response.json(
            { ok: false, error: "body must be {\"alerts_enabled\": 0|1} or 0|1" },
            { status: 400 }
          );
        }
        const now = new Date().toISOString();
        await db
          .prepare(`UPDATE policy SET alerts_enabled=?, updated_at=? WHERE id=1`)
          .bind(val, now)
          .run();
        const p = await getPolicy(db);
        return Response.json({
          ok: true,
          alerts_enabled: p.alerts_enabled === 1,
          policy: {
            soft_cap_usd: p.soft_cap_usd,
            alerts_enabled: p.alerts_enabled,
            alert_cooldown_minutes: p.alert_cooldown_minutes,
            stale_order_minutes: p.stale_order_minutes,
            pulse_stale_minutes: p.pulse_stale_minutes,
            updated_at: p.updated_at,
          },
        });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 503 }
        );
      }
    }

    if (request.method === "POST" && path === "/admin/policy") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        await migrate(env);
        const db = requireDb(env);
        const body = (await readJsonBody(request)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") {
          return Response.json({ ok: false, error: "JSON body required" }, { status: 400 });
        }
        const p = await getPolicy(db);
        const soft =
          body.soft_cap_usd != null ? Number(body.soft_cap_usd) : p.soft_cap_usd;
        const maxOpen =
          body.max_open_orders != null ? Number(body.max_open_orders) : p.max_open_orders;
        const stale =
          body.stale_order_minutes != null
            ? Number(body.stale_order_minutes)
            : p.stale_order_minutes;
        const cool =
          body.alert_cooldown_minutes != null
            ? Number(body.alert_cooldown_minutes)
            : p.alert_cooldown_minutes;
        const pulseStale =
          body.pulse_stale_minutes != null
            ? Number(body.pulse_stale_minutes)
            : p.pulse_stale_minutes;
        let alerts = p.alerts_enabled;
        if (body.alerts_enabled != null) {
          alerts = Number(body.alerts_enabled) ? 1 : 0;
        }
        if (
          ![soft, maxOpen, stale, cool, pulseStale].every((n) => Number.isFinite(n) && n >= 0) ||
          soft <= 0 ||
          pulseStale <= 0
        ) {
          return Response.json({ ok: false, error: "invalid numeric policy fields" }, { status: 400 });
        }
        const now = new Date().toISOString();
        await db
          .prepare(
            `UPDATE policy SET soft_cap_usd=?, max_open_orders=?, stale_order_minutes=?, alert_cooldown_minutes=?, alerts_enabled=?, pulse_stale_minutes=?, updated_at=? WHERE id=1`
          )
          .bind(soft, maxOpen, stale, cool, alerts, pulseStale, now)
          .run();

        let bookMark = await getBookMarkUsd(env, db);
        if (body.book_mark_usd != null) {
          const bm = Number(body.book_mark_usd);
          if (!Number.isFinite(bm) || bm <= 0) {
            return Response.json({ ok: false, error: "book_mark_usd must be > 0" }, { status: 400 });
          }
          await stateSet(db, "book_mark_usd", String(bm));
          bookMark = bm;
        }

        const updated = await getPolicy(db);
        const util = utilPct(bookMark, updated.soft_cap_usd);
        return Response.json({
          ok: true,
          policy: {
            soft_cap_usd: updated.soft_cap_usd,
            max_open_orders: updated.max_open_orders,
            stale_order_minutes: updated.stale_order_minutes,
            alert_cooldown_minutes: updated.alert_cooldown_minutes,
            pulse_stale_minutes: updated.pulse_stale_minutes,
            alerts_enabled: updated.alerts_enabled,
            updated_at: updated.updated_at,
            book_mark_usd: bookMark,
            util_pct: Number(util.toFixed(2)),
          },
        });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 503 }
        );
      }
    }


    if (request.method === "POST" && path === "/admin/book-pulse") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        const raw = await readJsonBody(request);
        const parsed = parseBookPulse(raw);
        if (!parsed.ok) {
          return Response.json({ ok: false, error: parsed.error }, { status: 400 });
        }
        await migrate(env);
        const db = requireDb(env);
        const policy = await getPolicy(db);
        const asOfRaw =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>).as_of
            : undefined;
        const asOf = evaluatePulseAsOf(asOfRaw, Date.now(), policy.pulse_stale_minutes);
        if (!asOf.ok) {
          return Response.json(
            { ok: false, error: asOf.error, code: asOf.code },
            { status: asOf.status }
          );
        }
        const result = await ingestBookPulse(env, parsed.pulse, asOf.asOfIso, asOf.ageMinutes);
        return Response.json({ ok: true, result });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e), parked: "D1" },
          { status: 503 }
        );
      }
    }

    if (request.method === "POST" && path === "/admin/predict-clip") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        const raw = await readJsonBody(request);
        const parsed = parsePredictClipBody(raw);
        if (!parsed.ok) {
          return Response.json({ ok: false, error: parsed.error }, { status: 400 });
        }
        if (parsed.clear) {
          const result = await clearPredictClip(env, "admin_clear");
          return Response.json({
            ok: true,
            result: {
              cleared: true,
              reason: result.reason,
              predict_clip_open: false,
              cash_out_alert_armed: false,
              r2: result.r2,
              ts: result.ts,
            },
          });
        }
        const result = await ingestPredictClip(env, parsed.clip);
        return Response.json({ ok: true, result });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e), parked: "D1" },
          { status: 503 }
        );
      }
    }

    if (request.method === "POST" && path === "/admin/fill-receipt") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        const raw = await readJsonBody(request);
        if (raw == null || typeof raw !== "object") {
          return Response.json({ ok: false, error: "JSON body required" }, { status: 400 });
        }
        const result = await ingestFillReceipt(env, raw);
        return Response.json({ ok: result.ok, result }, { status: result.ok ? 200 : 503 });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 503 }
        );
      }
    }

    if (request.method === "GET" && path === "/admin/flags") {
      if (!requireAdmin(request, env)) return unauthorized();
      try {
        await migrate(env);
        const db = requireDb(env);
        const soft_cap_flag = (await stateGet(db, "soft_cap_flag")) === "1" ? 1 : 0;
        const soft_cap_util_pct = await stateNum(db, "soft_cap_util_pct");
        const book_mark_usd = await stateNum(db, "book_mark_usd");
        const sleeve_net = await stateNum(db, "predict_sleeve_net");
        const last_pulse_ts = await stateGet(db, "last_pulse_ts");
        const p = await getPolicy(db);
        const freshness = evaluatePulseFreshness(last_pulse_ts, Date.now(), p.pulse_stale_minutes);
        const wake = deskFeederWakeContract(freshness, !!env.COINBASE_WAKE_URL);
        return Response.json({
          ok: true,
          soft_cap_flag,
          soft_cap_util_pct,
          book_mark_usd,
          sleeve_net,
          last_pulse_ts,
          pulse_age_minutes: freshness.pulse_age_minutes,
          pulse_stale: freshness.pulse_stale,
          pulse_stale_minutes: p.pulse_stale_minutes,
          never_pulsed: freshness.never_pulsed,
          wake,
          soft_cap_usd: p.soft_cap_usd,
          alerts_enabled: p.alerts_enabled === 1,
        });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 503 }
        );
      }
    }


    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      if (timingIsDreaming(controller.cron)) {
        await runDreaming(env);
        return;
      }
      if (timingIsNightSchool(controller.cron)) {
        await runNightSchool(env);
        await runWatch(env, `cron:${controller.cron}`);
      } else {
        await runWatch(env, `cron:${controller.cron || "*/15"}`);
      }
    } catch (e) {
      console.log("scheduled skipped:", e instanceof Error ? e.message : String(e));
      try {
        if (env.DB) {
          await setLastError(env.DB, e instanceof Error ? e.message : String(e));
        }
      } catch {
        /* ignore */
      }
    }
  },
};
