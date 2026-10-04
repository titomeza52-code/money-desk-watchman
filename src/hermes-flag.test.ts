import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBookPulseHermesFlag,
  buildHermesFlag,
  buildPredictCashOutHermesFlag,
  buildPulseStaleHermesFlag,
  wreckDistances,
} from "./hermes-flag.ts";

const NOT_COMPUTED = [
  "strike",
  "time_in_range",
  "stability",
  "whip",
  "whip_indicator",
  "book_depth",
  "confidence",
  "near_miss",
  "score",
  "weight",
];

function assertNotComputed(flag: Record<string, unknown>) {
  for (const key of NOT_COMPUTED) {
    assert.equal(Object.hasOwn(flag, key), false, key);
  }
  assert.equal(flag instanceof Promise, false);
}

describe("wreckDistances", () => {
  it("matches the existing mark-minus-line rounding", () => {
    assert.deepEqual(wreckDistances(118.5, 113, 92), {
      distance_to_wreck_pause_usd: 5.5,
      distance_to_wreck_kill_usd: 26.5,
    });
  });

  it("returns null distances when mark was not computed", () => {
    assert.deepEqual(wreckDistances(null, 113, 92), {
      distance_to_wreck_pause_usd: null,
      distance_to_wreck_kill_usd: null,
    });
  });
});

describe("Hermes flag builders", () => {
  it("copies computed fields synchronously and does not invent missing ones", () => {
    const flag = buildHermesFlag("pulse_stale", "observe-only", {
      price: 1,
      absent: undefined,
      empty: null,
    });
    assert.equal(flag.kind, "pulse_stale");
    assert.equal(flag.observe_only, true);
    assert.equal(flag.price, 1);
    assert.equal(flag.empty, null);
    assert.equal(Object.hasOwn(flag, "absent"), false);
    assert.equal(flag instanceof Promise, false);
  });

  it("pulse_stale flag carries the full watch computation", () => {
    const flag = buildPulseStaleHermesFlag({
      ts: "2026-09-13T00:20:00.000Z",
      check_id: 7,
      alert_id: 3,
      check_source: "cron:*/15",
      drift: true,
      drift_pct_threshold: 8,
      tickers: [{ product: "BTC-USD", price: 100, bid: 99, ask: 101, mid: 100 }],
      last_mids: { "BTC-USD": 90 },
      fetch_errors: [{ product: "ETH-USD", error: "HTTP 404", status: 404, transient: false }],
      reasons: [
        { kind: "pulse_stale", detail: "feeder dead" },
        { kind: "price_move", detail: "BTC mid moved", product: "BTC-USD", last: 90, now: 100, pct: 11.11 },
      ],
      book_mark_usd: 130,
      soft_cap_usd: 150,
      util_pct: 86.67,
      policy_snapshot: {
        soft_cap_usd: 150,
        max_open_orders: 5,
        alerts_enabled: 1,
        alert_cooldown_minutes: 60,
        stale_order_minutes: 120,
        pulse_stale_minutes: 45,
        book_mark_usd: 130,
        util_pct: 86.67,
      },
      last_pulse_ts: "2026-09-12T22:00:00.000Z",
      pulse_age_minutes: 140,
      pulse_stale: true,
      pulse_stale_minutes: 45,
      never_pulsed: false,
      last_ok_check_ts: "2026-09-13T00:05:00.000Z",
      last_ok_age_minutes: 15,
      fetch_ok: true,
      partial_ok: true,
      hard_fetch_fail: false,
      transient_only: false,
      price_moves: [
        { product: "BTC-USD", last: 90, now: 100, pct: 11.11, above_threshold: true },
        { product: "ETH-USD", last: 10, now: 10.2, pct: 2, above_threshold: false },
      ],
    });
    assert.deepEqual(flag, {
      kind: "pulse_stale",
      observe_only: true,
      note: "observe-only wake; feeder dead; POST /admin/book-pulse; no HMAC; no orders",
      ts: "2026-09-13T00:20:00.000Z",
      check_id: 7,
      alert_id: 3,
      check_source: "cron:*/15",
      drift: true,
      drift_pct_threshold: 8,
      tickers: [{ product: "BTC-USD", price: 100, bid: 99, ask: 101, mid: 100 }],
      last_mids: { "BTC-USD": 90 },
      fetch_errors: [{ product: "ETH-USD", error: "HTTP 404", status: 404, transient: false }],
      reasons: [
        { kind: "pulse_stale", detail: "feeder dead" },
        { kind: "price_move", detail: "BTC mid moved", product: "BTC-USD", last: 90, now: 100, pct: 11.11 },
      ],
      book_mark_usd: 130,
      soft_cap_usd: 150,
      util_pct: 86.67,
      policy_snapshot: {
        soft_cap_usd: 150,
        max_open_orders: 5,
        alerts_enabled: 1,
        alert_cooldown_minutes: 60,
        stale_order_minutes: 120,
        pulse_stale_minutes: 45,
        book_mark_usd: 130,
        util_pct: 86.67,
      },
      last_pulse_ts: "2026-09-12T22:00:00.000Z",
      pulse_age_minutes: 140,
      pulse_stale: true,
      pulse_stale_minutes: 45,
      never_pulsed: false,
      last_ok_check_ts: "2026-09-13T00:05:00.000Z",
      last_ok_age_minutes: 15,
      fetch_ok: true,
      partial_ok: true,
      hard_fetch_fail: false,
      transient_only: false,
      price_moves: [
        { product: "BTC-USD", last: 90, now: 100, pct: 11.11, above_threshold: true },
        { product: "ETH-USD", last: 10, now: 10.2, pct: 2, above_threshold: false },
      ],
    });
    assertNotComputed(flag);
    const moves = flag.price_moves as { above_threshold: boolean }[];
    assert.equal(moves.some((m) => m.above_threshold === false), true);
  });

  it("omits check_id when the checks insert did not return one", () => {
    const flag = buildPulseStaleHermesFlag({
      ts: "2026-09-13T00:20:00.000Z",
      alert_id: 3,
      check_source: "cron",
      drift: true,
      drift_pct_threshold: 8,
      tickers: [{ product: "ETH-USD", price: 10 }],
      last_mids: {},
      fetch_errors: [],
      reasons: [{ kind: "pulse_stale", detail: "dead" }],
      book_mark_usd: 130,
      soft_cap_usd: 150,
      util_pct: 86.67,
      policy_snapshot: {},
      last_pulse_ts: null,
      pulse_age_minutes: null,
      pulse_stale: true,
      pulse_stale_minutes: 45,
      never_pulsed: false,
      last_ok_check_ts: null,
    });
    assert.equal(Object.hasOwn(flag, "check_id"), false);
    assert.equal(flag.last_pulse_ts, null);
    assert.equal(flag.pulse_age_minutes, null);
    const ticker = (flag.tickers as Record<string, unknown>[])[0];
    assert.equal(Object.hasOwn(ticker, "bid"), false);
    assert.equal(ticker.price, 10);
    assert.equal(ticker.product, "ETH-USD");
  });

  it("predict cash-out flag carries side, mark, expiry, and ids", () => {
    const flag = buildPredictCashOutHermesFlag({
      ts: "2026-09-13T00:20:00.000Z",
      check_id: 9,
      alert_id: 4,
      market_id: "SYNTH-DEMO-MKT",
      side: "YES",
      contracts: 10,
      cost_all_in: 4,
      max_payout: 10,
      mark_now: 0.85,
      expiry_ts: "2026-09-14T00:00:00.000Z",
      fee_exit_est: null,
      mark_up: 4.5,
      max_profit: 6,
      cash_out_threshold: 4.2,
      cash_out_threshold_frac: 0.7,
      cash_out_floor: 0.5,
      should_alert: true,
      meets_cash_out_frac: true,
      meets_cash_out_floor: true,
    });
    assert.equal(flag.kind, "predict_cash_out");
    assert.equal(flag.observe_only, true);
    assert.equal(flag.side, "YES");
    assert.equal(flag.mark_now, 0.85);
    assert.equal(flag.expiry_ts, "2026-09-14T00:00:00.000Z");
    assert.equal(flag.market_id, "SYNTH-DEMO-MKT");
    assert.equal(flag.alert_id, 4);
    assert.equal(flag.check_id, 9);
    assert.equal(flag.fee_exit_est, null);
    assert.equal(flag.mark_up, 4.5);
    assert.equal(flag.meets_cash_out_frac, true);
    assert.equal(flag.meets_cash_out_floor, true);
    assertNotComputed(flag);
  });

  it("book-pulse flag carries wreck lines, snapshot age, and omits unset morpho block", () => {
    const flag = buildBookPulseHermesFlag({
      kind: "book_pulse:book_mark_low",
      ts: "2026-09-13T00:20:00.000Z",
      as_of: "2026-09-13T00:19:00.000Z",
      pulse_age_minutes: 1,
      check_id: 11,
      alert_id: 6,
      book_mark_usd: 110,
      wreck_pause_usd: 113,
      wreck_kill_usd: 92,
      distance_to_wreck_pause_usd: -3,
      distance_to_wreck_kill_usd: 18,
      open_order_count: 0,
      morpho_usd: 11.31,
      dry_usd: 6.91,
      predict_sleeve_net: -4.5,
      soft_cap_util_pct: null,
      soft_cap_flag: 0,
      soft_cap_usd: 150,
      util_pct: 73.3,
      mark_hit: true,
      sleeve_hit: false,
      dry_idle_hit: false,
    });
    assert.equal(flag.kind, "book_pulse:book_mark_low");
    assert.equal(flag.book_mark_usd, 110);
    assert.equal(flag.wreck_pause_usd, 113);
    assert.equal(flag.wreck_kill_usd, 92);
    assert.equal(flag.distance_to_wreck_pause_usd, -3);
    assert.equal(flag.distance_to_wreck_kill_usd, 18);
    assert.equal(flag.pulse_age_minutes, 1);
    assert.equal(flag.as_of, "2026-09-13T00:19:00.000Z");
    assert.equal(flag.alert_id, 6);
    assert.equal(flag.check_id, 11);
    assert.equal(flag.mark_hit, true);
    assert.equal(flag.sleeve_hit, false);
    assert.equal(flag.dry_idle_hit, false);
    assert.equal(Object.hasOwn(flag, "morpho_convert_blocked"), false);
    assertNotComputed(flag);
  });
});
