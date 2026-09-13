import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AS_OF_FUTURE_SKEW_MS,
  PULSE_STALE_MINUTES_DEFAULT,
  deskFeederWakeContract,
  evaluatePulseAsOf,
  evaluatePulseFreshness,
} from "./pulse-contract.ts";

const NOW = Date.parse("2026-09-13T00:20:00.000Z");
const STALE_MIN = PULSE_STALE_MINUTES_DEFAULT;

describe("evaluatePulseAsOf", () => {
  it("rejects missing as_of", () => {
    for (const raw of [undefined, null, "", "  "]) {
      const r = evaluatePulseAsOf(raw, NOW, STALE_MIN);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.status, 400);
        assert.equal(r.code, "as_of_missing");
      }
    }
  });

  it("rejects non-string and unparseable as_of", () => {
    const num = evaluatePulseAsOf(NOW, NOW, STALE_MIN);
    assert.equal(num.ok, false);
    if (!num.ok) assert.equal(num.code, "as_of_invalid");

    const junk = evaluatePulseAsOf("yesterday-ish", NOW, STALE_MIN);
    assert.equal(junk.ok, false);
    if (!junk.ok) assert.equal(junk.code, "as_of_invalid");
  });

  it("rejects as_of beyond future skew", () => {
    const future = new Date(NOW + AS_OF_FUTURE_SKEW_MS + 1_000).toISOString();
    const r = evaluatePulseAsOf(future, NOW, STALE_MIN);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "as_of_future");
      assert.equal(r.status, 400);
    }
  });

  it("accepts as_of within future skew", () => {
    const nearFuture = new Date(NOW + 30_000).toISOString();
    const r = evaluatePulseAsOf(nearFuture, NOW, STALE_MIN);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.asOfIso, nearFuture);
  });

  it("accepts fresh snapshot under pulse_stale_minutes", () => {
    const asOf = new Date(NOW - 44 * 60_000).toISOString();
    const r = evaluatePulseAsOf(asOf, NOW, STALE_MIN);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.asOfIso, asOf);
      assert.ok(r.ageMinutes < STALE_MIN);
    }
  });

  it("rejects snapshot older than pulse_stale_minutes", () => {
    const asOf = new Date(NOW - 46 * 60_000).toISOString();
    const r = evaluatePulseAsOf(asOf, NOW, STALE_MIN);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "as_of_stale");
      assert.match(r.error, /do not refresh last_pulse_ts/);
    }
  });

  it("does not treat overlay date-only as_of as a live book snapshot", () => {
    const r = evaluatePulseAsOf("2026-09-08", NOW, STALE_MIN);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "as_of_stale");
  });
});

describe("evaluatePulseFreshness + deskFeederWakeContract", () => {
  it("never_pulsed is not pulse_stale; wake.needed with reason never_pulsed", () => {
    const f = evaluatePulseFreshness(null, NOW, STALE_MIN);
    assert.equal(f.pulse_stale, false);
    assert.equal(f.never_pulsed, true);
    assert.equal(f.pulse_age_minutes, null);
    const wake = deskFeederWakeContract(f, false);
    assert.deepEqual(wake, {
      needed: true,
      reason: "never_pulsed",
      kind: "desk_feeder",
      action: "POST /admin/book-pulse",
      url_configured: false,
    });
  });

  it("fresh last_pulse_ts → wake.needed false", () => {
    const ts = new Date(NOW - 10 * 60_000).toISOString();
    const f = evaluatePulseFreshness(ts, NOW, STALE_MIN);
    assert.equal(f.pulse_stale, false);
    assert.equal(f.never_pulsed, false);
    assert.equal(f.pulse_age_minutes, 10);
    const wake = deskFeederWakeContract(f, true);
    assert.equal(wake.needed, false);
    assert.equal(wake.reason, null);
    assert.equal(wake.url_configured, true);
    assert.equal(wake.action, "POST /admin/book-pulse");
  });

  it("last_pulse_ts older than threshold → pulse_stale + wake reason", () => {
    const ts = new Date(NOW - 50 * 60_000).toISOString();
    const f = evaluatePulseFreshness(ts, NOW, STALE_MIN);
    assert.equal(f.pulse_stale, true);
    assert.equal(f.never_pulsed, false);
    const wake = deskFeederWakeContract(f, false);
    assert.equal(wake.needed, true);
    assert.equal(wake.reason, "pulse_stale");
  });

  it("unparseable last_pulse_ts does not false-fire pulse_stale", () => {
    const f = evaluatePulseFreshness("not-a-time", NOW, STALE_MIN);
    assert.equal(f.pulse_stale, false);
    assert.equal(f.never_pulsed, true);
  });
});
