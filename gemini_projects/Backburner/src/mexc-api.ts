import { MEXC_API, MEXC_INTERVAL, CANDLES_TO_FETCH } from './config.js';
import type { Candle, Timeframe, SymbolInfo, MEXCTickerResponse } from './types.js';

// Rate limiter to avoid hitting MEXC limits
class RateLimiter {
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private maxConcurrent: number;
  private minDelayMs: number;
  private lastRequestTime = 0;

  constructor(maxConcurrent = 10, minDelayMs = 100) {
    this.maxConcurrent = maxConcurrent;
    this.minDelayMs = minDelayMs;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        // Ensure minimum delay between requests
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minDelayMs) {
          await sleep(this.minDelayMs - timeSinceLastRequest);
        }

        this.running++;
        this.lastRequestTime = Date.now();

        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      if (this.running < this.maxConcurrent) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }

  private processQueue() {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const rateLimiter = new RateLimiter(10, 50);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with retry logic
async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      if (response.status === 429) {
        // Rate limited - wait and retry
        await sleep(1000 * (i + 1));
        continue;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error as Error;
      await sleep(500 * (i + 1));
    }
  }

  throw lastError || new Error('Failed after retries');
}

// Get all available trading symbols from MEXC
export async function getExchangeInfo(): Promise<SymbolInfo[]> {
  const url = `${MEXC_API.BASE_URL}${MEXC_API.EXCHANGE_INFO}`;
  const response = await fetchWithRetry(url);
  const data = await response.json();

  return data.symbols.map((s: Record<string, unknown>) => ({
    symbol: s.symbol as string,
    baseAsset: s.baseAsset as string,
    quoteAsset: s.quoteAsset as string,
    status: s.status as string,
    isSpotTradingAllowed: s.isSpotTradingAllowed as boolean,
    isMarginTradingAllowed: s.isMarginTradingAllowed as boolean,
  }));
}

// Get 24hr ticker data for volume filtering
export async function get24hTickers(): Promise<MEXCTickerResponse[]> {
  const url = `${MEXC_API.BASE_URL}${MEXC_API.TICKER_24H}`;
  const response = await fetchWithRetry(url);
  return response.json();
}

// Get kline/candlestick data for a symbol
export async function getKlines(
  symbol: string,
  timeframe: Timeframe,
  limit = CANDLES_TO_FETCH
): Promise<Candle[]> {
  return rateLimiter.execute(async () => {
    const interval = MEXC_INTERVAL[timeframe];
    const url = `${MEXC_API.BASE_URL}${MEXC_API.KLINES}?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const response = await fetchWithRetry(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error(`Invalid kline response for ${symbol}`);
    }

    return data.map((k: (number | string)[]) => ({
      timestamp: k[0] as number,
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
  });
}

// Get current price for a symbol
export async function getCurrentPrice(symbol: string): Promise<number> {
  return rateLimiter.execute(async () => {
    const url = `${MEXC_API.BASE_URL}${MEXC_API.TICKER_PRICE}?symbol=${symbol}`;
    const response = await fetchWithRetry(url);
    const data = await response.json();
    return parseFloat(data.price);
  });
}

// Batch fetch klines for multiple symbols
export async function batchGetKlines(
  symbols: string[],
  timeframe: Timeframe,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, Candle[]>> {
  const results = new Map<string, Candle[]>();
  let completed = 0;

  const promises = symbols.map(async (symbol) => {
    try {
      const candles = await getKlines(symbol, timeframe);
      results.set(symbol, candles);
    } catch (error) {
      // Skip symbols that fail
      console.error(`Failed to fetch ${symbol}: ${(error as Error).message}`);
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, symbols.length);
      }
    }
  });

  await Promise.all(promises);
  return results;
}
