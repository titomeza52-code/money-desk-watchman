/**
 * Observe-only Desk feeder freshness contract.
 * - Reject stale/future/missing as_of on POST /admin/book-pulse (do not refresh last_pulse_ts).
 * - GET /health reports pulse_stale + wake { needed, reason, action } so Desk can self-heal.
 * Never HMAC / never orders.
 */

export const PULSE_STALE_MINUTES_DEFAULT = 45;
/** Allow small clock skew so Desk "now" is not rejected as future. */
export const AS_OF_FUTURE_SKEW_MS = 120_000;

export type AsOfRejectCode = "as_of_missing" | "as_of_invalid" | "as_of_future" | "as_of_stale";

export type AsOfAccept = {
  ok: true;
  asOfMs: number;
  asOfIso: string;
  ageMinutes: number;
};

export type AsOfReject = {
  ok: false;
  status: 400;
  code: AsOfRejectCode;
  error: string;
};

export function parseAsOfMs(
  raw: unknown
): { ok: true; ms: number } | { ok: false; code: "as_of_missing" | "as_of_invalid"; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, code: "as_of_missing", error: "as_of required (ISO-8601 snapshot time)" };
  }
  if (typeof raw !== "string") {
    return { ok: false, code: "as_of_invalid", error: "as_of must be an ISO-8601 string" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, code: "as_of_missing", error: "as_of required (ISO-8601 snapshot time)" };
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return { ok: false, code: "as_of_invalid", error: "as_of is not a parseable ISO-8601 timestamp" };
  }
  return { ok: true, ms };
}

export function evaluatePulseAsOf(
  raw: unknown,
  nowMs: number,
  pulseStaleMinutes: number,
  futureSkewMs: number = AS_OF_FUTURE_SKEW_MS
): AsOfAccept | AsOfReject {
  const parsed = parseAsOfMs(raw);
  if (!parsed.ok) {
    return { ok: false, status: 400, code: parsed.code, error: parsed.error };
  }
  const staleMs = Math.max(0, pulseStaleMinutes) * 60_000;
  if (parsed.ms > nowMs + futureSkewMs) {
    return {
      ok: false,
      status: 400,
      code: "as_of_future",
      error: `as_of is in the future (skew>${Math.round(futureSkewMs / 1000)}s)`,
    };
  }
  const ageMs = nowMs - parsed.ms;
  if (ageMs > staleMs) {
    const ageMin = Number((ageMs / 60_000).toFixed(1));
    return {
      ok: false,
      status: 400,
      code: "as_of_stale",
      error: `as_of age ${ageMin}m > pulse_stale_minutes=${pulseStaleMinutes} (reject stale snapshot; do not refresh last_pulse_ts)`,
    };
  }
  return {
    ok: true,
    asOfMs: parsed.ms,
    asOfIso: new Date(parsed.ms).toISOString(),
    ageMinutes: Number((Math.max(0, ageMs) / 60_000).toFixed(2)),
  };
}

export type PulseFreshness = {
  last_pulse_ts: string | null;
  pulse_age_minutes: number | null;
  pulse_stale: boolean;
  never_pulsed: boolean;
};

export function evaluatePulseFreshness(
  lastPulseTs: string | null | undefined,
  nowMs: number,
  pulseStaleMinutes: number
): PulseFreshness {
  if (lastPulseTs == null || lastPulseTs === "") {
    return {
      last_pulse_ts: lastPulseTs ?? null,
      pulse_age_minutes: null,
      pulse_stale: false,
      never_pulsed: true,
    };
  }
  const ms = Date.parse(lastPulseTs);
  if (!Number.isFinite(ms)) {
    return {
      last_pulse_ts: lastPulseTs,
      pulse_age_minutes: null,
      pulse_stale: false,
      never_pulsed: true,
    };
  }
  const ageMs = nowMs - ms;
  const ageMinutes = Number.isFinite(ageMs) && ageMs >= 0 ? Number((ageMs / 60_000).toFixed(2)) : null;
  const pulseStaleMs = pulseStaleMinutes * 60_000;
  const pulse_stale = Number.isFinite(ageMs) && ageMs > pulseStaleMs;
  return {
    last_pulse_ts: lastPulseTs,
    pulse_age_minutes: ageMinutes,
    pulse_stale,
    never_pulsed: false,
  };
}

export type DeskFeederWakeReason = "pulse_stale" | "never_pulsed" | null;

export type DeskFeederWake = {
  needed: boolean;
  reason: DeskFeederWakeReason;
  kind: "desk_feeder";
  action: "POST /admin/book-pulse";
  url_configured: boolean;
};

/** GET /health wake contract — no GET side effects; Desk POSTs book-pulse when needed. */
export function deskFeederWakeContract(freshness: PulseFreshness, urlConfigured: boolean): DeskFeederWake {
  if (freshness.never_pulsed) {
    return {
      needed: true,
      reason: "never_pulsed",
      kind: "desk_feeder",
      action: "POST /admin/book-pulse",
      url_configured: urlConfigured,
    };
  }
  if (freshness.pulse_stale) {
    return {
      needed: true,
      reason: "pulse_stale",
      kind: "desk_feeder",
      action: "POST /admin/book-pulse",
      url_configured: urlConfigured,
    };
  }
  return {
    needed: false,
    reason: null,
    kind: "desk_feeder",
    action: "POST /admin/book-pulse",
    url_configured: urlConfigured,
  };
}
