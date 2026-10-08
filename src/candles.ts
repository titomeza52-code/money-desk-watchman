/**
 * money-desk-watchman candles fetcher (observe-only, public Coinbase data).
 *
 * Fetches 15-minute candles (granularity 900) for BTC-USD and ETH-USD and
 * computes the indicator fields the hermes-enricher requires as input:
 *   - RSI (14-period, Wilder smoothing)
 *   - MACD (12, 26, 9): macd_line, signal_line, histogram, cross direction
 *   - volume_ratio: last bar volume / 20-bar average
 *   - vwap: cumulative (typical price * volume) / cumulative volume
 *   - support / resistance: min / max close over the last 20 bars
 *
 * Never places, cancels, or modifies orders. No Coinbase account keys.
 */

export const CANDLE_GRANULARITY = 900; // 15 minutes
export const CANDLE_LIMIT = 60;       // enough for RSI(14) + MACD(26) + 20-bar avg

export type Candle = {
  time: number;   // unix seconds
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
};

export type CandleIndicators = {
  product: string;
  rsi: number | null;
  macd_line: number | null;
  signal_line: number | null;
  histogram: number | null;
  macd_cross: "bullish" | "bearish" | "none" | null;
  volume_ratio: number | null;
  vwap: number | null;
  support: number | null;
  resistance: number | null;
  bars: number;
  last_close: number | null;
  error?: string;
  status?: number;
  transient?: boolean;
};

const COINBASE_BASE = "https://api.exchange.coinbase.com";

/** Parse Coinbase candles endpoint: [[time, low, high, open, close, volume], ...] newest first. */
export function parseCandles(raw: unknown): Candle[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) return null;
    const time = Number(row[0]);
    const low = Number(row[1]);
    const high = Number(row[2]);
    const open = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(low) ||
      !Number.isFinite(high) ||
      !Number.isFinite(open) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume) ||
      close <= 0
    ) {
      return null;
    }
    out.push({ time, low, high, open, close, volume });
  }
  // Coinbase returns newest first; reverse to chronological
  out.reverse();
  return out;
}

/** Wilder RSI. Seed = simple mean of first `period` gains/losses, then Wilder smoothing. */
export function rsiWilder(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** EMA with smoothing factor k = 2/(period+1). */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

/**
 * MACD(12, 26, 9). macd_line = EMA12 - EMA26 of closes.
 * signal_line = EMA9 of the macd series; histogram = macd - signal.
 * Cross direction compares the last two macd values against the signal.
 */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): {
  macd_line: number;
  signal_line: number;
  histogram: number;
  cross: "bullish" | "bearish" | "none";
} | null {
  if (closes.length < slow + signalPeriod) return null;
  const macdSeries: number[] = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const window = closes.slice(0, i + 1);
    const eFast = ema(window, fast);
    const eSlow = ema(window, slow);
    if (eFast == null || eSlow == null) return null;
    macdSeries.push(eFast - eSlow);
  }
  if (macdSeries.length < signalPeriod + 1) return null;
  const signalFull = ema(macdSeries, signalPeriod);
  // signal at the previous bar for cross detection
  const signalPrev = ema(macdSeries.slice(0, -1), signalPeriod);
  if (signalFull == null || signalPrev == null) return null;
  const macdNow = macdSeries[macdSeries.length - 1];
  const macdPrev = macdSeries[macdSeries.length - 2];
  const histNow = macdNow - signalFull;
  const histPrev = macdPrev - signalPrev;
  let cross: "bullish" | "bearish" | "none" = "none";
  if (histPrev <= 0 && histNow > 0) cross = "bullish";
  else if (histPrev >= 0 && histNow < 0) cross = "bearish";
  return { macd_line: macdNow, signal_line: signalFull, histogram: histNow, cross };
}

/** Volume ratio: last bar / mean of last 20 bars. */
export function volumeRatio(volumes: number[], lookback = 20): number | null {
  if (volumes.length < lookback) return null;
  const slice = volumes.slice(-lookback);
  const avg = slice.reduce((a, b) => a + b, 0) / lookback;
  if (avg <= 0) return null;
  return volumes[volumes.length - 1] / avg;
}

/** VWAP over the provided bars: sum(typical_price * volume) / sum(volume). */
export function vwap(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    num += tp * c.volume;
    den += c.volume;
  }
  return den > 0 ? num / den : null;
}

/** Support = min close, resistance = max close over last `lookback` bars. */
export function supportResistance(
  candles: Candle[],
  lookback = 20
): { support: number; resistance: number } | null {
  if (candles.length < lookback) return null;
  const slice = candles.slice(-lookback);
  let lo = slice[0].close;
  let hi = slice[0].close;
  for (const c of slice) {
    if (c.close < lo) lo = c.close;
    if (c.close > hi) hi = c.close;
  }
  return { support: lo, resistance: hi };
}

export function computeIndicators(
  product: string,
  candles: Candle[]
): CandleIndicators {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const m = macd(closes);
  const sr = supportResistance(candles);
  return {
    product,
    rsi: rsiWilder(closes, 14),
    macd_line: m?.macd_line ?? null,
    signal_line: m?.signal_line ?? null,
    histogram: m?.histogram ?? null,
    macd_cross: m?.cross ?? null,
    volume_ratio: volumeRatio(volumes, 20),
    vwap: vwap(candles),
    support: sr?.support ?? null,
    resistance: sr?.resistance ?? null,
    bars: candles.length,
    last_close: closes.length ? closes[closes.length - 1] : null,
  };
}

export function isTransientFetchStatus(status?: number): boolean {
  if (status == null) return false;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

/** Fetch candles for one product. Returns indicators or a structured error. */
export async function fetchCandles(
  product: string
): Promise<CandleIndicators> {
  const url = `${COINBASE_BASE}/products/${product}/candles?granularity=${CANDLE_GRANULARITY}&limit=${CANDLE_LIMIT}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "money-desk-watchman/1.1" },
    });
    if (!res.ok) {
      return {
        product,
        rsi: null,
        macd_line: null,
        signal_line: null,
        histogram: null,
        macd_cross: null,
        volume_ratio: null,
        vwap: null,
        support: null,
        resistance: null,
        bars: 0,
        last_close: null,
        error: `HTTP ${res.status}`,
        status: res.status,
        transient: isTransientFetchStatus(res.status),
      };
    }
    const raw = await res.json();
    const candles = parseCandles(raw);
    if (!candles) {
      return {
        product,
        rsi: null,
        macd_line: null,
        signal_line: null,
        histogram: null,
        macd_cross: null,
        volume_ratio: null,
        vwap: null,
        support: null,
        resistance: null,
        bars: 0,
        last_close: null,
        error: "invalid candle payload",
      };
    }
    return computeIndicators(product, candles);
  } catch (e) {
    return {
      product,
      rsi: null,
      macd_line: null,
      signal_line: null,
      histogram: null,
      macd_cross: null,
      volume_ratio: null,
      vwap: null,
      support: null,
      resistance: null,
      bars: 0,
      last_close: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Fetch candles for all watched products in parallel. */
export async function fetchAllCandles(
  products: readonly string[]
): Promise<CandleIndicators[]> {
  return Promise.all(products.map((p) => fetchCandles(p)));
}
