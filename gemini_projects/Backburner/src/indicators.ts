import type { Candle, RSIResult } from './types.js';

/**
 * Calculate RSI (Relative Strength Index)
 * Uses Wilder's smoothing method (exponential moving average)
 */
export function calculateRSI(candles: Candle[], period = 14): RSIResult[] {
  if (candles.length < period + 1) {
    return [];
  }

  const results: RSIResult[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate price changes
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // Calculate initial average gain and loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // First RSI value
  if (avgLoss === 0) {
    results.push({ value: 100, timestamp: candles[period].timestamp });
  } else {
    const rs = avgGain / avgLoss;
    results.push({ value: 100 - (100 / (1 + rs)), timestamp: candles[period].timestamp });
  }

  // Calculate subsequent RSI values using Wilder's smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      results.push({ value: 100, timestamp: candles[i + 1].timestamp });
    } else {
      const rs = avgGain / avgLoss;
      results.push({ value: 100 - (100 / (1 + rs)), timestamp: candles[i + 1].timestamp });
    }
  }

  return results;
}

/**
 * Get the current (most recent) RSI value
 */
export function getCurrentRSI(candles: Candle[], period = 14): number | null {
  const rsiValues = calculateRSI(candles, period);
  if (rsiValues.length === 0) return null;
  return rsiValues[rsiValues.length - 1].value;
}

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(sum / period);
  }
  return result;
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];

  const multiplier = 2 / (period + 1);
  const result: number[] = [];

  // Start with SMA for first value
  const sma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(sma);

  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    const ema = (values[i] - result[result.length - 1]) * multiplier + result[result.length - 1];
    result.push(ema);
  }

  return result;
}

/**
 * Calculate Average Volume over a period
 */
export function calculateAvgVolume(candles: Candle[], period: number): number {
  if (candles.length < period) {
    return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
  }
  const recentCandles = candles.slice(-period);
  return recentCandles.reduce((sum, c) => sum + c.volume, 0) / period;
}

/**
 * Find the highest high in a range of candles
 */
export function findHighestHigh(candles: Candle[]): { price: number; index: number; timestamp: number } {
  let highest = candles[0];
  let highestIndex = 0;

  for (let i = 1; i < candles.length; i++) {
    if (candles[i].high > highest.high) {
      highest = candles[i];
      highestIndex = i;
    }
  }

  return {
    price: highest.high,
    index: highestIndex,
    timestamp: highest.timestamp,
  };
}

/**
 * Find the lowest low in a range of candles
 */
export function findLowestLow(candles: Candle[]): { price: number; index: number; timestamp: number } {
  let lowest = candles[0];
  let lowestIndex = 0;

  for (let i = 1; i < candles.length; i++) {
    if (candles[i].low < lowest.low) {
      lowest = candles[i];
      lowestIndex = i;
    }
  }

  return {
    price: lowest.low,
    index: lowestIndex,
    timestamp: lowest.timestamp,
  };
}

/**
 * Detect if there was a significant impulse move
 * Returns the impulse details if found, null otherwise
 */
export function detectImpulseMove(
  candles: Candle[],
  minPercentMove: number,
  lookbackPeriod = 50
): {
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  percentMove: number;
  direction: 'up' | 'down';
} | null {
  if (candles.length < lookbackPeriod) return null;

  const recentCandles = candles.slice(-lookbackPeriod);

  // Find significant swing points
  const highest = findHighestHigh(recentCandles);
  const lowest = findLowestLow(recentCandles);

  // Determine if we had an upward impulse (for long setups)
  // The high should come AFTER the low for an upward impulse
  if (highest.index > lowest.index) {
    const percentMove = ((highest.price - lowest.price) / lowest.price) * 100;

    if (percentMove >= minPercentMove) {
      return {
        startIndex: lowest.index,
        endIndex: highest.index,
        startPrice: lowest.price,
        endPrice: highest.price,
        percentMove,
        direction: 'up',
      };
    }
  }

  // Check for downward impulse (for short setups)
  if (lowest.index > highest.index) {
    const percentMove = ((highest.price - lowest.price) / highest.price) * 100;

    if (percentMove >= minPercentMove) {
      return {
        startIndex: highest.index,
        endIndex: lowest.index,
        startPrice: highest.price,
        endPrice: lowest.price,
        percentMove,
        direction: 'down',
      };
    }
  }

  return null;
}

/**
 * Check if volume is contracting during pullback
 */
export function isVolumeContracting(
  impulseCandles: Candle[],
  pullbackCandles: Candle[]
): boolean {
  if (impulseCandles.length === 0 || pullbackCandles.length === 0) {
    return false;
  }

  const impulseAvgVol = impulseCandles.reduce((sum, c) => sum + c.volume, 0) / impulseCandles.length;
  const pullbackAvgVol = pullbackCandles.reduce((sum, c) => sum + c.volume, 0) / pullbackCandles.length;

  // Volume should be lower during pullback
  return pullbackAvgVol < impulseAvgVol * 0.8; // At least 20% lower
}

/**
 * Check if RSI just crossed below a threshold
 * Returns true if RSI was above threshold and is now below
 */
export function rsiJustCrossedBelow(
  rsiValues: RSIResult[],
  threshold: number,
  lookback = 3
): boolean {
  if (rsiValues.length < lookback + 1) return false;

  const recent = rsiValues.slice(-lookback);
  const current = recent[recent.length - 1].value;

  // Check if current is below threshold and at least one recent was above
  if (current >= threshold) return false;

  for (let i = 0; i < recent.length - 1; i++) {
    if (recent[i].value >= threshold) {
      return true;
    }
  }

  return false;
}

/**
 * Determine higher timeframe trend direction
 * Simple implementation: compare current price to SMA
 */
export function isHigherTFBullish(candles: Candle[], smaPeriod = 20): boolean {
  if (candles.length < smaPeriod) return false;

  const closes = candles.map(c => c.close);
  const sma = calculateSMA(closes, smaPeriod);

  if (sma.length === 0) return false;

  const currentPrice = candles[candles.length - 1].close;
  const currentSMA = sma[sma.length - 1];

  return currentPrice > currentSMA;
}
