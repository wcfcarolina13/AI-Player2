import type { Candle, Timeframe, BackburnerSetup, SetupState } from './types.js';
import { DEFAULT_CONFIG } from './config.js';
import {
  calculateRSI,
  getCurrentRSI,
  detectImpulseMove,
  isVolumeContracting,
  rsiJustCrossedBelow,
  isHigherTFBullish,
  findHighestHigh,
  calculateAvgVolume,
} from './indicators.js';

/**
 * The Backburner Detector
 *
 * Implements The Chart Guys' Backburner strategy:
 * 1. Identify a strong impulse move (new high/significant breakout)
 * 2. Wait for the FIRST oversold condition (RSI < 30)
 * 3. This is the high-probability entry for a bounce
 *
 * Key principles:
 * - Only the FIRST oversold after impulse is valid
 * - Volume should contract during pullback
 * - Higher timeframe trend should remain bullish
 */
export class BackburnerDetector {
  private config = DEFAULT_CONFIG;
  private activeSetups: Map<string, BackburnerSetup> = new Map();

  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Generate a unique key for a setup
   */
  private getSetupKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}-${timeframe}`;
  }

  /**
   * Analyze candles and detect/update Backburner setups
   */
  analyzeSymbol(
    symbol: string,
    timeframe: Timeframe,
    candles: Candle[],
    higherTFCandles?: Candle[]
  ): BackburnerSetup | null {
    if (candles.length < 50) {
      return null;
    }

    const key = this.getSetupKey(symbol, timeframe);
    const existingSetup = this.activeSetups.get(key);
    const now = Date.now();

    // Calculate current RSI
    const rsiValues = calculateRSI(candles, this.config.rsiPeriod);
    const currentRSI = getCurrentRSI(candles, this.config.rsiPeriod);

    if (currentRSI === null || rsiValues.length < 5) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;

    // Check higher timeframe trend if available
    const higherTFBullish = higherTFCandles
      ? isHigherTFBullish(higherTFCandles)
      : undefined;

    // If we have an existing setup, update it
    if (existingSetup) {
      return this.updateExistingSetup(
        existingSetup,
        candles,
        currentRSI,
        currentPrice,
        higherTFBullish
      );
    }

    // Try to detect a new setup
    return this.detectNewSetup(
      symbol,
      timeframe,
      candles,
      rsiValues,
      currentRSI,
      currentPrice,
      higherTFBullish
    );
  }

  /**
   * Detect a new Backburner setup
   */
  private detectNewSetup(
    symbol: string,
    timeframe: Timeframe,
    candles: Candle[],
    rsiValues: { value: number; timestamp: number }[],
    currentRSI: number,
    currentPrice: number,
    higherTFBullish?: boolean
  ): BackburnerSetup | null {
    // Step 1: Look for an impulse move
    const impulse = detectImpulseMove(candles, this.config.minImpulsePercent);

    if (!impulse || impulse.direction !== 'up') {
      // We only care about upward impulses for long setups
      return null;
    }

    // Step 2: Check if we're now in pullback territory
    // Current price should be below the impulse high but above the impulse low
    if (currentPrice >= impulse.endPrice) {
      // Still at or above the high - not pulling back yet
      return null;
    }

    if (currentPrice <= impulse.startPrice) {
      // Broke below the impulse low - setup invalidated
      return null;
    }

    // Step 3: Check if this is the FIRST oversold condition after the impulse
    // Look for RSI crossing below 30 recently
    const isFirstOversold = this.isFirstOversoldAfterImpulse(
      rsiValues,
      impulse.endIndex,
      candles.length
    );

    if (!isFirstOversold && currentRSI >= this.config.rsiOversoldThreshold) {
      // Not oversold yet - keep watching but don't create setup
      return null;
    }

    // Step 4: Analyze volume
    const impulseCandles = candles.slice(impulse.startIndex, impulse.endIndex + 1);
    const pullbackCandles = candles.slice(impulse.endIndex + 1);
    const volumeContracting = isVolumeContracting(impulseCandles, pullbackCandles);

    // Determine setup state
    let state: SetupState = 'watching';
    if (currentRSI < this.config.rsiDeepOversoldThreshold) {
      state = 'deep_oversold';
    } else if (currentRSI < this.config.rsiOversoldThreshold) {
      state = 'triggered';
    }

    // Only create setup if we're in an actionable state
    if (state === 'watching') {
      return null;
    }

    const isActionable = state === 'triggered' || state === 'deep_oversold';

    const setup: BackburnerSetup = {
      symbol,
      timeframe,
      state,
      impulseHigh: impulse.endPrice,
      impulseLow: impulse.startPrice,
      impulseStartTime: candles[impulse.startIndex].timestamp,
      impulseEndTime: candles[impulse.endIndex].timestamp,
      impulsePercentMove: impulse.percentMove,
      currentRSI,
      rsiAtTrigger: currentRSI,
      currentPrice,
      entryPrice: isActionable ? currentPrice : undefined,
      detectedAt: Date.now(),
      triggeredAt: isActionable ? Date.now() : undefined,
      lastUpdated: Date.now(),
      impulseAvgVolume: calculateAvgVolume(impulseCandles, impulseCandles.length),
      pullbackAvgVolume: calculateAvgVolume(pullbackCandles, pullbackCandles.length),
      volumeContracting,
      higherTFBullish,
    };

    this.activeSetups.set(this.getSetupKey(symbol, timeframe), setup);
    return setup;
  }

  /**
   * Check if this is the first RSI oversold condition after the impulse move
   */
  private isFirstOversoldAfterImpulse(
    rsiValues: { value: number; timestamp: number }[],
    impulseEndIndex: number,
    totalCandles: number
  ): boolean {
    // Calculate how many RSI values correspond to candles after the impulse
    const rsiOffset = totalCandles - rsiValues.length;
    const startRSIIndex = Math.max(0, impulseEndIndex - rsiOffset);

    // Check if there's been any oversold condition since the impulse
    let oversoldCount = 0;
    for (let i = startRSIIndex; i < rsiValues.length; i++) {
      if (rsiValues[i].value < this.config.rsiOversoldThreshold) {
        oversoldCount++;
      }
    }

    // This is the first oversold if we only have one occurrence
    // (which is the current one)
    return oversoldCount <= 1;
  }

  /**
   * Update an existing setup based on new data
   */
  private updateExistingSetup(
    setup: BackburnerSetup,
    candles: Candle[],
    currentRSI: number,
    currentPrice: number,
    higherTFBullish?: boolean
  ): BackburnerSetup | null {
    const now = Date.now();
    const key = this.getSetupKey(setup.symbol, setup.timeframe);

    // Update basic fields
    setup.currentRSI = currentRSI;
    setup.currentPrice = currentPrice;
    setup.lastUpdated = now;
    if (higherTFBullish !== undefined) {
      setup.higherTFBullish = higherTFBullish;
    }

    // Check for invalidation conditions
    if (this.isSetupInvalidated(setup, candles)) {
      setup.state = 'played_out';
      this.activeSetups.delete(key);
      return setup;
    }

    // Update state based on current conditions
    setup.state = this.determineSetupState(setup, currentRSI);

    // If setup is played out, remove it
    if (setup.state === 'played_out') {
      this.activeSetups.delete(key);
    } else {
      this.activeSetups.set(key, setup);
    }

    return setup;
  }

  /**
   * Check if a setup has been invalidated
   */
  private isSetupInvalidated(setup: BackburnerSetup, candles: Candle[]): boolean {
    const currentPrice = candles[candles.length - 1].close;

    // Invalidation 1: Price broke below the impulse low (structure broken)
    if (currentPrice < setup.impulseLow) {
      return true;
    }

    // Invalidation 2: Price recovered back to impulse high (target reached)
    if (setup.state === 'triggered' || setup.state === 'deep_oversold') {
      if (currentPrice >= setup.impulseHigh * 0.99) {
        // Reached target - setup played out successfully
        return true;
      }
    }

    // Invalidation 3: RSI has gone oversold multiple times (not first anymore)
    // This is a simplified check - ideally track all oversold occurrences
    if (setup.state === 'bouncing' && setup.currentRSI < this.config.rsiOversoldThreshold) {
      // Second oversold - no longer the first, invalidate
      return true;
    }

    return false;
  }

  /**
   * Determine the current state of a setup
   */
  private determineSetupState(setup: BackburnerSetup, currentRSI: number): SetupState {
    const prevState = setup.state;

    // Deep oversold
    if (currentRSI < this.config.rsiDeepOversoldThreshold) {
      return 'deep_oversold';
    }

    // Still in triggered zone
    if (currentRSI < this.config.rsiOversoldThreshold) {
      return 'triggered';
    }

    // RSI recovered above 30
    if (prevState === 'triggered' || prevState === 'deep_oversold') {
      // Now bouncing - setup is playing out
      if (currentRSI > 40) {
        // Good bounce, consider played out
        return 'played_out';
      }
      return 'bouncing';
    }

    // If bouncing and RSI stays above 30, setup is complete
    if (prevState === 'bouncing') {
      if (currentRSI > 50) {
        return 'played_out';
      }
      return 'bouncing';
    }

    return setup.state;
  }

  /**
   * Get all active setups
   */
  getActiveSetups(): BackburnerSetup[] {
    return Array.from(this.activeSetups.values());
  }

  /**
   * Get setups for a specific timeframe
   */
  getSetupsByTimeframe(timeframe: Timeframe): BackburnerSetup[] {
    return this.getActiveSetups().filter(s => s.timeframe === timeframe);
  }

  /**
   * Get setups in a specific state
   */
  getSetupsByState(state: SetupState): BackburnerSetup[] {
    return this.getActiveSetups().filter(s => s.state === state);
  }

  /**
   * Remove a setup manually
   */
  removeSetup(symbol: string, timeframe: Timeframe): void {
    this.activeSetups.delete(this.getSetupKey(symbol, timeframe));
  }

  /**
   * Clear all setups
   */
  clearAllSetups(): void {
    this.activeSetups.clear();
  }

  /**
   * Get the total number of active setups
   */
  getActiveSetupCount(): number {
    return this.activeSetups.size;
  }
}
