/**
 * money-desk-watchman flag push (observe-only).
 *
 * Pushes per-product flag rows to the hermes-enricher worker. If the enricher
 * is down, the flag is queued in D1 with a retry counter and retried on the
 * next cron tick. Never HMAC, never orders, no Coinbase keys.
 */

export type FlagRow = {
  ts: string;
  product: string;
  price: number;
  bid?: number;
  ask?: number;
  mid?: number;
  rsi: number | null;
  macd_line: number | null;
  signal_line: number | null;
  histogram: number | null;
  macd_cross: string | null;
  volume_ratio: number | null;
  vwap: number | null;
  support: number | null;
  resistance: number | null;
  source: string;
  tag?: number;
  market?: string;
  side?: string;
  note?: string;
};

export type PushResult = {
  product: string;
  status: "pushed" | "queued" | "error";
  http_status?: number;
  error?: string;
  retry_count?: number;
};

const MAX_RETRIES = 5;

/** Insert or refresh a queued flag row. Upsert on (product, ts). */
export async function queueFlag(
  db: D1Database,
  flag: FlagRow
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO flag_queue (ts, product, payload_json, retry_count, last_error, next_retry_ts)
       VALUES (?, ?, ?, 0, NULL, ?)
       ON CONFLICT(product, ts) DO UPDATE SET
         payload_json = excluded.payload_json,
         retry_count = 0,
         last_error = NULL,
         next_retry_ts = excluded.next_retry_ts`
    )
    .bind(flag.ts, flag.product, JSON.stringify(flag), flag.ts)
    .run();
}

/**
 * Attempt to POST a flag to the enricher. On non-OK or network error, queue it.
 * Returns the push result for logging.
 */
export async function pushFlag(
  env: { HERMES_ENRICHER_URL?: string },
  db: D1Database,
  flag: FlagRow
): Promise<PushResult> {
  const url = env.HERMES_ENRICHER_URL;
  if (!url) {
    // No enricher configured: queue for manual drain
    await queueFlag(db, flag);
    return { product: flag.product, status: "queued", error: "HERMES_ENRICHER_URL not set" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(flag),
    });
    if (res.ok) {
      return { product: flag.product, status: "pushed", http_status: res.status };
    }
    const errText = await res.text().catch(() => "");
    await queueFlag(db, flag);
    // bump retry count on the queued row
    await db
      .prepare(
        `UPDATE flag_queue SET retry_count = retry_count + 1,
           last_error = ?, next_retry_ts = ?
         WHERE product = ? AND ts = ?`
      )
      .bind(
        `HTTP ${res.status}: ${errText.slice(0, 200)}`,
        new Date(Date.now() + 15 * 60_000).toISOString(),
        flag.product,
        flag.ts
      )
      .run();
    return {
      product: flag.product,
      status: "queued",
      http_status: res.status,
      error: `HTTP ${res.status}`,
    };
  } catch (e) {
    await queueFlag(db, flag);
    await db
      .prepare(
        `UPDATE flag_queue SET retry_count = retry_count + 1,
           last_error = ?, next_retry_ts = ?
         WHERE product = ? AND ts = ?`
      )
      .bind(
        e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        new Date(Date.now() + 15 * 60_000).toISOString(),
        flag.product,
        flag.ts
      )
      .run();
    return {
      product: flag.product,
      status: "queued",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Drain the retry queue: re-attempt flags whose next_retry_ts has passed
 * and retry_count < MAX_RETRIES. Called from the cron path alongside runWatch.
 */
export async function drainRetryQueue(
  env: { HERMES_ENRICHER_URL?: string },
  db: D1Database,
  nowIso: string
): Promise<PushResult[]> {
  const rows = await db
    .prepare(
      `SELECT ts, product, payload_json, retry_count FROM flag_queue
       WHERE next_retry_ts IS NOT NULL AND next_retry_ts <= ?
         AND retry_count < ?
       ORDER BY ts ASC LIMIT 20`
    )
    .bind(nowIso, MAX_RETRIES)
    .all<{
      ts: string;
      product: string;
      payload_json: string;
      retry_count: number;
    }>();

  const results: PushResult[] = [];
  for (const row of rows.results ?? []) {
    let flag: FlagRow;
    try {
      flag = JSON.parse(row.payload_json) as FlagRow;
    } catch {
      // corrupt payload: mark dead
      await db
        .prepare(
          `UPDATE flag_queue SET retry_count = ?, last_error = ?, next_retry_ts = NULL
           WHERE product = ? AND ts = ?`
        )
        .bind(MAX_RETRIES, "corrupt payload_json", row.product, row.ts)
        .run();
      results.push({ product: row.product, status: "error", error: "corrupt payload" });
      continue;
    }
    const r = await pushFlag(env, db, flag);
    // pushFlag already bumped retry_count on failure; on success the row is stale
    // but harmless. Clean up successfully pushed rows.
    if (r.status === "pushed") {
      await db
        .prepare(`DELETE FROM flag_queue WHERE product = ? AND ts = ?`)
        .bind(row.product, row.ts)
        .run();
    }
    results.push({ ...r, retry_count: row retry_count + 1 });
  }
  return results;
}

/** Queue depth for /health reporting. */
export async function queueDepth(db: D1Database): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS c FROM flag_queue`).first<{
      c: number;
    }>();
  return r?.c ?? 0;
}
