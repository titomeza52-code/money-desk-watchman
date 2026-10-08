/**
 * Observe-only flag body posted to Hermes (COINBASE_WAKE_URL).
 * Copies fields the caller already computed. No I/O, no retry, no extra checks.
 * No score, weight, or second pass. Near-miss is not computed here.
 * Undefined keys are omitted. Null is kept when the caller computed an absence.
 * Never an order. One observe-only destination (COINBASE_WAKE_URL).
 */

export type HermesFlag = Record<string, unknown> & {
  kind: string;
  observe_only: true;
  note: string;
};

function assignDefined(target: HermesFlag, source: Record<string, unknown>): HermesFlag {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}

/** Synchronous. Does not validate, wait, or fill in fields the caller did not compute. */
export function buildHermesFlag(kind: string, note: string, computed: Record<string, unknown>): HermesFlag {
  return assignDefined({ kind, observe_only: true, note }, computed);
}

export function wreckDistances(
  mark: number | null,
  pause: number,
  kill: number
): { distance_to_wreck_pause_usd: number | null; distance_to_wreck_kill_usd: number | null } {
  if (mark == null || !Number.isFinite(mark)) {
    return { distance_to_wreck_pause_usd: null, distance_to_wreck_kill_usd: null };
  }
  return {
    distance_to_wreck_pause_usd: Number((mark - pause).toFixed(2)),
    distance_to_wreck_kill_usd: Number((mark - kill).toFixed(2)),
  };
}

export type FlagTicker = {
  product: string;
  price: number;
  bid?: number;
  ask?: number;
  mid?: number;
};

export type FlagReason = {
  kind: string;
  detail: string;
  product?: string;
  last?: number;
  now?: number;
  pct?: number;
};

export type FlagFetchError = {
  product: string;
  error: string;
  status?: number;
  transient: boolean;
};

function tickerRow(t: FlagTicker): Record<string, unknown> {
  const row: Record<string, unknown> = { product: t.product, price: t.price };
  if (typeof t.bid === "number" && Number.isFinite(t.bid)) row.bid = t.bid;
  if (typeof t.ask === "number" && Number.isFinite(t.ask)) row.ask = t.ask;
  if (typeof t.mid === "number" && Number.isFinite(t.mid)) row.mid = t.mid;
  return row;
}

function reasonRow(r: FlagReason): Record<string, unknown> {
  const row: Record<string, unknown> = { kind: r.kind, detail: r.detail };
  if (r.product !== undefined) row.product = r.product;
  if (typeof r.last === "number" && Number.isFinite(r.last)) row.last = r.last;
  if (typeof r.now === "number" && Number.isFinite(r.now)) row.now = r.now;
  if (typeof r.pct === "number" && Number.isFinite(r.pct)) row.pct = r.pct;
  return row;
}

/** Watch flag (pulse_stale). Price, product, drift, book mark, snapshot age, ids. */
export function buildPulseStaleHermesFlag(input: {
  ts: string;
  check_id?: number;
  alert_id: number;
  check_source: string;
  drift: boolean;
  drift_pct_threshold: number;
  tickers: FlagTicker[];
  last_mids: Record<string, number>;
  fetch_errors: FlagFetchError[];
  reasons: FlagReason[];
  book_mark_usd: number;
  soft_cap_usd: number;
  util_pct: number;
  policy_snapshot: Record<string, unknown>;
  last_pulse_ts: string | null;
  pulse_age_minutes: number | null;
  pulse_stale: boolean;
  pulse_stale_minutes: number;
  never_pulsed: boolean;
  last_ok_check_ts: string | null;
  last_ok_age_minutes: number | null;
  fetch_ok: boolean;
  partial_ok: boolean;
  hard_fetch_fail: boolean;
  transient_only: boolean;
  price_moves: { product: string; last: number; now: number; pct: number; above_threshold: boolean }[];
  /** D1 alert kind when this watch flag is not pulse_stale. */
  alert_kind?: string;
}): HermesFlag {
  return buildHermesFlag(input.alert_kind || "pulse_stale", "observe-only wake; feeder dead; POST /admin/book-pulse; no HMAC; no orders", {
    ts: input.ts,
    check_id: input.check_id,
    alert_id: input.alert_id,
    check_source: input.check_source,
    drift: input.drift,
    drift_pct_threshold: input.drift_pct_threshold,
    tickers: input.tickers.map(tickerRow),
    last_mids: input.last_mids,
    fetch_errors: input.fetch_errors,
    reasons: input.reasons.map(reasonRow),
    book_mark_usd: input.book_mark_usd,
    soft_cap_usd: input.soft_cap_usd,
    util_pct: input.util_pct,
    policy_snapshot: input.policy_snapshot,
    last_pulse_ts: input.last_pulse_ts,
    pulse_age_minutes: input.pulse_age_minutes,
    pulse_stale: input.pulse_stale,
    pulse_stale_minutes: input.pulse_stale_minutes,
    never_pulsed: input.never_pulsed,
    last_ok_check_ts: input.last_ok_check_ts,
    last_ok_age_minutes: input.last_ok_age_minutes,
    fetch_ok: input.fetch_ok,
    partial_ok: input.partial_ok,
    hard_fetch_fail: input.hard_fetch_fail,
    transient_only: input.transient_only,
    price_moves: input.price_moves,
  });
}

/** Predict cash-out flag. Price is mark_now; expiry is expiry_ts; side and ids included. */
export function buildPredictCashOutHermesFlag(input: {
  ts: string;
  check_id?: number;
  alert_id: number;
  market_id: string;
  side: string;
  contracts: number;
  cost_all_in: number;
  max_payout: number;
  mark_now: number;
  expiry_ts: string;
  fee_exit_est: number | null;
  mark_up: number;
  max_profit: number;
  cash_out_threshold: number;
  cash_out_threshold_frac: number;
  cash_out_floor: number;
  should_alert: boolean;
  meets_cash_out_frac: boolean;
  meets_cash_out_floor: boolean;
}): HermesFlag {
  return buildHermesFlag("predict_cash_out", "observe-only wake; no HMAC; no orders", {
    ts: input.ts,
    check_id: input.check_id,
    alert_id: input.alert_id,
    market_id: input.market_id,
    side: input.side,
    contracts: input.contracts,
    cost_all_in: input.cost_all_in,
    max_payout: input.max_payout,
    mark_now: input.mark_now,
    expiry_ts: input.expiry_ts,
    fee_exit_est: input.fee_exit_est,
    mark_up: input.mark_up,
    max_profit: input.max_profit,
    cash_out_threshold: input.cash_out_threshold,
    cash_out_threshold_frac: input.cash_out_threshold_frac,
    cash_out_floor: input.cash_out_floor,
    should_alert: input.should_alert,
    meets_cash_out_frac: input.meets_cash_out_frac,
    meets_cash_out_floor: input.meets_cash_out_floor,
  });
}

/** Book-pulse alert flag. Wreck pause/kill, distances, snapshot age, ids. */
export function buildBookPulseHermesFlag(input: {
  kind: string;
  ts: string;
  as_of: string;
  pulse_age_minutes: number;
  check_id?: number;
  alert_id: number;
  book_mark_usd: number | null;
  wreck_pause_usd: number;
  wreck_kill_usd: number;
  distance_to_wreck_pause_usd: number | null;
  distance_to_wreck_kill_usd: number | null;
  open_order_count: number | null;
  morpho_usd: number | null;
  dry_usd: number | null;
  predict_sleeve_net: number | null;
  soft_cap_util_pct: number | null;
  soft_cap_flag: number;
  soft_cap_usd: number;
  morpho_convert_blocked?: boolean;
  util_pct: number | null;
  mark_hit: boolean;
  sleeve_hit: boolean;
  dry_idle_hit: boolean;
}): HermesFlag {
  return buildHermesFlag(input.kind, "L3 observe-only book pulse — no order placement/cancel/modify", {
    ts: input.ts,
    as_of: input.as_of,
    pulse_age_minutes: input.pulse_age_minutes,
    check_id: input.check_id,
    alert_id: input.alert_id,
    book_mark_usd: input.book_mark_usd,
    wreck_pause_usd: input.wreck_pause_usd,
    wreck_kill_usd: input.wreck_kill_usd,
    distance_to_wreck_pause_usd: input.distance_to_wreck_pause_usd,
    distance_to_wreck_kill_usd: input.distance_to_wreck_kill_usd,
    open_order_count: input.open_order_count,
    morpho_usd: input.morpho_usd,
    dry_usd: input.dry_usd,
    predict_sleeve_net: input.predict_sleeve_net,
    soft_cap_util_pct: input.soft_cap_util_pct,
    soft_cap_flag: input.soft_cap_flag,
    soft_cap_usd: input.soft_cap_usd,
    morpho_convert_blocked: input.morpho_convert_blocked,
    util_pct: input.util_pct,
    mark_hit: input.mark_hit,
    sleeve_hit: input.sleeve_hit,
    dry_idle_hit: input.dry_idle_hit,
  });
}
