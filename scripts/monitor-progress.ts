#!/usr/bin/env tsx

import { Pool } from 'pg';
import { createPublicClient, http } from 'viem';
import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';
import { Command } from 'commander';

import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { formatNumber } from './shared/formatting.js';

type ProgressMetrics = {
  currentBlock: bigint;
  safeBlock: bigint;
  latestBlock: bigint;
  progressPercent: number;
  blocksRemaining: bigint;
  timestamp: Date;
};

type MonitorOptions = {
  dbUrl: string;
  schema: string;
  rpcUrl: string;
  confirmations: number;
};

class ProgressMonitor {
  private _pool: Pool;
  private _rpcClient: ReturnType<typeof createPublicClient>;
  private _schema: string;
  private _confirmations: number;

  private _lastMetrics: ProgressMetrics | null = null;
  private _history: Array<{ timestamp: Date; currentBlock: bigint }> = [];
  private _historyWindow = 10;
  private _latestBlock: bigint | null = null;
  private _lastRpcUpdate: Date | null = null;

  constructor(options: MonitorOptions) {
    this._pool = new Pool({ connectionString: options.dbUrl });
    this._schema = validateSchemaName(options.schema);
    this._confirmations = options.confirmations;

    this._rpcClient = createPublicClient({
      transport: http(options.rpcUrl),
    });
  }

  async start(): Promise<void> {
    process.on('SIGINT', () => {
      console.log();
      console.log(chalk.dim('Monitor stopped.'));
      process.exit(0);
    });

    // Initial RPC call.
    await this._updateLatestBlock();

    // Update RPC every 10 seconds.
    setInterval(() => {
      this._updateLatestBlock().catch(() => {
        // Ignore errors, keep using cached value.
      });
    }, 10000);

    // Poll DB and render every 5 seconds.
    setInterval(() => {
      this._updateMetrics().catch(() => {
        // Ignore errors.
      });
    }, 5000);
  }

  private async _updateLatestBlock(): Promise<void> {
    const latestBlock = await this._rpcClient.getBlockNumber();
    this._latestBlock = latestBlock;
    this._lastRpcUpdate = new Date();
  }

  private async _updateMetrics(): Promise<void> {
    if (!this._latestBlock) return;

    // Query cursor from DB.
    const result = await this._pool.query<{ fetchedToBlock: string }>(
      `SELECT fetched_to_block as "fetchedToBlock" FROM ${this._schema}._cursor LIMIT 1`,
    );

    if (result.rows.length === 0) {
      console.log(chalk.yellow('No cursor found in database.'));
      return;
    }

    const currentBlock = BigInt(result.rows[0]!.fetchedToBlock);
    const safeBlock = this._latestBlock - BigInt(this._confirmations);
    const progressPercent = safeBlock > 0n ? (Number(currentBlock) / Number(safeBlock)) * 100 : 0;
    const blocksRemaining = safeBlock - currentBlock;

    const metrics: ProgressMetrics = {
      currentBlock,
      safeBlock,
      latestBlock: this._latestBlock,
      progressPercent,
      blocksRemaining,
      timestamp: new Date(),
    };

    this._lastMetrics = metrics;
    this._history.push({ timestamp: metrics.timestamp, currentBlock: metrics.currentBlock });

    // Keep history window size.
    if (this._history.length > this._historyWindow) {
      this._history.shift();
    }

    this._renderProgress();
  }

  private _renderProgress(): void {
    if (!this._lastMetrics) return;

    const m = this._lastMetrics;
    const { blocksPerSec, eta } = this._calculateSpeed();

    // Clear screen and move to top.
    console.clear();

    console.log(
      boxen(chalk.bold.blue('📊 INDEXING PROGRESS MONITOR 📊'), {
        padding: 1,
        borderColor: 'blue',
        borderStyle: 'double',
      }),
    );
    console.log();

    console.log(
      boxen(chalk.bold('Current Progress'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

    // Progress bar.
    const barWidth = 50;
    const filledWidth = Math.floor((m.progressPercent / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    const bar = chalk.cyan('█'.repeat(filledWidth)) + chalk.dim('░'.repeat(emptyWidth));

    console.log(`${bar} ${chalk.bold.cyan(m.progressPercent.toFixed(2) + '%')}`);
    console.log();

    // Metrics table.
    const table = new Table({
      colWidths: [20, 40],
      style: { head: [] },
    });

    const rpcAge = this._lastRpcUpdate
      ? Math.floor((Date.now() - this._lastRpcUpdate.getTime()) / 1000)
      : null;
    const rpcStatus = rpcAge !== null ? chalk.dim(`(updated ${rpcAge}s ago)`) : '';

    table.push(
      [chalk.cyan('Current Block'), chalk.bold(formatNumber(m.currentBlock))],
      [chalk.cyan('Target Block'), chalk.bold(formatNumber(m.safeBlock))],
      [chalk.cyan('Latest Block'), `${chalk.dim(formatNumber(m.latestBlock))} ${rpcStatus}`],
      [chalk.cyan('Blocks Remaining'), chalk.yellow(formatNumber(m.blocksRemaining))],
      [
        chalk.cyan('Speed'),
        blocksPerSec > 0
          ? chalk.green(`${blocksPerSec.toFixed(1)} blocks/sec`)
          : chalk.dim('calculating...'),
      ],
      [
        chalk.cyan('ETA'),
        eta ? chalk.magenta(this._formatDuration(eta)) : chalk.dim('calculating...'),
      ],
    );

    console.log(table.toString());
    console.log();
  }

  private _calculateSpeed(): { blocksPerSec: number; eta: number | null } {
    if (this._history.length < 2 || !this._lastMetrics) {
      return { blocksPerSec: 0, eta: null };
    }

    const first = this._history[0]!;
    const last = this._history[this._history.length - 1]!;

    const blocksDiff = Number(last.currentBlock - first.currentBlock);
    const timeDiff = (last.timestamp.getTime() - first.timestamp.getTime()) / 1000; // seconds

    if (timeDiff === 0) {
      return { blocksPerSec: 0, eta: null };
    }

    const blocksPerSec = blocksDiff / timeDiff;

    if (blocksPerSec <= 0) {
      return { blocksPerSec: 0, eta: null };
    }

    const remainingBlocks = Number(this._lastMetrics.blocksRemaining);
    const eta = remainingBlocks / blocksPerSec;

    return { blocksPerSec, eta };
  }

  private _formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

// CLI setup.
const program = new Command();

program
  .name('monitor')
  .description('Monitor indexing progress in real-time')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--rpc-url <url>', 'RPC endpoint URL')
  .option('--confirmations <n>', 'Number of confirmations for safe head', '64');

program.parse();

const options = program.opts<{
  dbUrl: string;
  schema: string;
  rpcUrl: string;
  confirmations: string;
}>();

const monitor = new ProgressMonitor({
  dbUrl: options.dbUrl,
  schema: options.schema,
  rpcUrl: options.rpcUrl,
  confirmations: parseInt(options.confirmations, 10),
});

await monitor.start();
