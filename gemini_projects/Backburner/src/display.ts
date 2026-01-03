import chalk from 'chalk';
import Table from 'cli-table3';
import type { BackburnerSetup, Timeframe, SetupState } from './types.js';

/**
 * Format time ago from timestamp
 */
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Format percentage with color
 */
function formatPercent(value: number, inverse = false): string {
  const formatted = `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  if (inverse) {
    return value >= 0 ? chalk.red(formatted) : chalk.green(formatted);
  }
  return value >= 0 ? chalk.green(formatted) : chalk.red(formatted);
}

/**
 * Format RSI with color coding
 */
function formatRSI(rsi: number): string {
  const formatted = rsi.toFixed(1);
  if (rsi < 20) return chalk.bgRed.white.bold(` ${formatted} `);
  if (rsi < 30) return chalk.red.bold(formatted);
  if (rsi < 40) return chalk.yellow(formatted);
  if (rsi > 70) return chalk.green.bold(formatted);
  return formatted;
}

/**
 * Format setup state with color and emoji
 */
function formatState(state: SetupState): string {
  switch (state) {
    case 'triggered':
      return chalk.bgGreen.black.bold(' TRIGGERED ');
    case 'deep_oversold':
      return chalk.bgRed.white.bold(' DEEP OVERSOLD ');
    case 'bouncing':
      return chalk.bgYellow.black(' BOUNCING ');
    case 'watching':
      return chalk.gray('watching');
    case 'played_out':
      return chalk.strikethrough.gray('played out');
    default:
      return state;
  }
}

/**
 * Format timeframe badge
 */
function formatTimeframe(tf: Timeframe): string {
  const colors: Record<Timeframe, (s: string) => string> = {
    '5m': chalk.cyan,
    '15m': chalk.blue,
    '1h': chalk.magenta,
    '4h': chalk.yellow,
    '1d': chalk.red,
  };
  return colors[tf]?.(tf) || tf;
}

/**
 * Create the main display table for setups
 */
export function createSetupsTable(setups: BackburnerSetup[]): string {
  if (setups.length === 0) {
    return chalk.gray('\n  No active Backburner setups detected.\n');
  }

  // Sort by state priority and RSI
  const sorted = [...setups].sort((a, b) => {
    const statePriority: Record<SetupState, number> = {
      deep_oversold: 0,
      triggered: 1,
      bouncing: 2,
      watching: 3,
      played_out: 4,
    };
    if (statePriority[a.state] !== statePriority[b.state]) {
      return statePriority[a.state] - statePriority[b.state];
    }
    return a.currentRSI - b.currentRSI;
  });

  const table = new Table({
    head: [
      chalk.white.bold('Symbol'),
      chalk.white.bold('TF'),
      chalk.white.bold('State'),
      chalk.white.bold('RSI'),
      chalk.white.bold('Price'),
      chalk.white.bold('Impulse'),
      chalk.white.bold('Vol Ratio'),
      chalk.white.bold('HTF'),
      chalk.white.bold('Detected'),
    ],
    style: {
      head: [],
      border: ['gray'],
    },
    colWidths: [12, 6, 16, 8, 14, 10, 10, 6, 12],
  });

  for (const setup of sorted) {
    const pullbackPercent = ((setup.currentPrice - setup.impulseHigh) / setup.impulseHigh) * 100;
    const volumeRatio = setup.impulseAvgVolume > 0
      ? (setup.pullbackAvgVolume / setup.impulseAvgVolume).toFixed(2)
      : 'N/A';

    table.push([
      chalk.white.bold(setup.symbol.replace('USDT', '')),
      formatTimeframe(setup.timeframe),
      formatState(setup.state),
      formatRSI(setup.currentRSI),
      setup.currentPrice.toPrecision(6),
      formatPercent(setup.impulsePercentMove),
      setup.volumeContracting ? chalk.green(volumeRatio) : chalk.yellow(volumeRatio),
      setup.higherTFBullish === undefined
        ? chalk.gray('-')
        : setup.higherTFBullish
          ? chalk.green('↑')
          : chalk.red('↓'),
      timeAgo(setup.detectedAt),
    ]);
  }

  return table.toString();
}

/**
 * Create a summary line
 */
export function createSummary(
  setups: BackburnerSetup[],
  eligibleSymbols: number,
  isScanning: boolean,
  statusMessage?: string
): string {
  const byState = {
    triggered: setups.filter(s => s.state === 'triggered').length,
    deep_oversold: setups.filter(s => s.state === 'deep_oversold').length,
    bouncing: setups.filter(s => s.state === 'bouncing').length,
  };

  const byTimeframe = {
    '5m': setups.filter(s => s.timeframe === '5m').length,
    '15m': setups.filter(s => s.timeframe === '15m').length,
    '1h': setups.filter(s => s.timeframe === '1h').length,
  };

  const statusIcon = isScanning ? chalk.green('●') : chalk.red('○');
  const timestamp = new Date().toLocaleTimeString();

  const lines = [
    '',
    `${statusIcon} ${chalk.bold('Backburner Screener')} | ${eligibleSymbols} symbols | ${setups.length} active setups`,
    chalk.gray(`  Last update: ${timestamp}${statusMessage ? ` | ${statusMessage}` : ''}`),
    '',
    chalk.gray(`  Triggered: ${byState.triggered} | Deep Oversold: ${byState.deep_oversold} | Bouncing: ${byState.bouncing}`),
    chalk.gray(`  5m: ${byTimeframe['5m']} | 15m: ${byTimeframe['15m']} | 1h: ${byTimeframe['1h']}`),
    '',
  ];

  return lines.join('\n');
}

/**
 * Create a notification for a new setup
 */
export function createSetupNotification(setup: BackburnerSetup, type: 'new' | 'updated' | 'removed'): string {
  const symbol = chalk.bold(setup.symbol.replace('USDT', ''));
  const tf = formatTimeframe(setup.timeframe);
  const rsi = formatRSI(setup.currentRSI);

  switch (type) {
    case 'new':
      return chalk.green(`\n✦ NEW: ${symbol} ${tf} - RSI ${rsi} - ${formatState(setup.state)}\n`);
    case 'updated':
      return chalk.yellow(`\n⟳ UPDATE: ${symbol} ${tf} - RSI ${rsi} - ${formatState(setup.state)}\n`);
    case 'removed':
      return chalk.gray(`\n✗ REMOVED: ${symbol} ${tf} - Setup played out\n`);
    default:
      return '';
  }
}

/**
 * Create the header banner
 */
export function createHeader(): string {
  return `
${chalk.cyan.bold('╔══════════════════════════════════════════════════════════════════╗')}
${chalk.cyan.bold('║')}  ${chalk.white.bold('BACKBURNER SCREENER')} - ${chalk.gray('TCG Strategy Scanner for MEXC')}             ${chalk.cyan.bold('║')}
${chalk.cyan.bold('╠══════════════════════════════════════════════════════════════════╣')}
${chalk.cyan.bold('║')}  ${chalk.gray('Strategy: First RSI < 30 after impulse move = High prob bounce')}  ${chalk.cyan.bold('║')}
${chalk.cyan.bold('║')}  ${chalk.gray('Timeframes: 5m, 15m, 1h | RSI Triggers: <30 (entry), <20 (add)')}  ${chalk.cyan.bold('║')}
${chalk.cyan.bold('╚══════════════════════════════════════════════════════════════════╝')}
`;
}

/**
 * Create progress bar for scanning
 */
export function createProgressBar(completed: number, total: number, phase: string): string {
  const percent = Math.floor((completed / total) * 100);
  const barLength = 40;
  const filled = Math.floor(barLength * (completed / total));
  const empty = barLength - filled;

  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));

  return `\n  ${bar} ${percent}% | ${phase}\n`;
}

/**
 * Clear the terminal
 */
export function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[0f');
}

/**
 * Move cursor to top of terminal
 */
export function moveCursorToTop(): void {
  process.stdout.write('\x1B[H');
}
