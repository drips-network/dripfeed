export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type LogContext = {
  [key: string]: unknown;
};

export type LogEntry = {
  level: LogLevel;
  message: string;
  context?: LogContext;
  timestamp: string;
};

/**
 * Simple console logger - sufficient for current requirements.
 */
class Logger {
  private minLevel: LogLevel = 'INFO';
  private prettyFormat: boolean = false;

  constructor(prettyFormat: boolean = false) {
    this.prettyFormat = prettyFormat;
  }

  private levelPriority: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  };

  private levelColors: Record<LogLevel, string> = {
    DEBUG: '\x1b[36m', // Cyan
    INFO: '\x1b[32m', // Green
    WARN: '\x1b[33m', // Yellow
    ERROR: '\x1b[31m', // Red
  };

  private reset = '\x1b[0m';
  private dim = '\x1b[2m';
  private bold = '\x1b[1m';
  private cyan = '\x1b[36m';

  private fieldColors: Record<string, string> = {
    progressPercent: this.bold + this.cyan,
  };

  setMinLevel(level: LogLevel): this {
    this.minLevel = level;
    return this;
  }

  setPrettyFormat(pretty: boolean): this {
    this.prettyFormat = pretty;
    return this;
  }

  startTimer(operation: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug('operation_duration', { operation, durationMs: duration });
    };
  }

  debug(message: string, context?: LogContext): void {
    this._log('DEBUG', message, context);
  }

  info(message: string, context?: LogContext): void {
    this._log('INFO', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this._log('WARN', message, context);
  }

  error(message: string, context?: LogContext): void {
    this._log('ERROR', message, context);
  }

  gracefulShutdown(signal?: string): void {
    this.info('graceful_shutdown', { signal });
  }

  shutdownComplete(): void {
    this.info('shutdown_complete');
  }

  private _shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private _formatPretty(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString().split('T')[1]!.slice(0, -1); // HH:MM:SS.mmm
    const color = this.levelColors[level];
    const levelStr = level.padEnd(5);

    let output = `${this.dim}${timestamp}${this.reset} ${color}${levelStr}${this.reset} ${this.bold}${message}${this.reset}`;

    if (context && Object.keys(context).length > 0) {
      const serializedContext = this._serializeBigInt(context);
      const colorizedContext = this._colorizeFields(serializedContext);
      output += ` ${this.dim}${colorizedContext}${this.reset}`;
    }

    return output;
  }

  private _colorizeFields(context: unknown): string {
    if (typeof context !== 'object' || context === null) {
      return JSON.stringify(context);
    }

    const entries = Object.entries(context).map(([key, value]) => {
      const serialized = JSON.stringify(value);
      const fieldColor = this.fieldColors[key];
      if (fieldColor) {
        return `"${key}":${fieldColor}${serialized}${this.reset}${this.dim}`;
      }
      return `"${key}":${serialized}`;
    });

    return `{${entries.join(',')}}`;
  }

  private _serializeBigInt(obj: unknown): unknown {
    if (typeof obj === 'bigint') {
      return obj.toString();
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this._serializeBigInt(item));
    }
    if (obj !== null && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, this._serializeBigInt(value)]),
      );
    }
    return obj;
  }

  private _log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this._shouldLog(level)) return;

    let output: string;

    if (this.prettyFormat) {
      output = this._formatPretty(level, message, context);
    } else {
      const entry: LogEntry = {
        level,
        message,
        timestamp: new Date().toISOString(),
      };

      if (context && Object.keys(context).length > 0) {
        entry.context = this._serializeBigInt(context) as LogContext;
      }

      output = JSON.stringify(entry);
    }

    if (level === 'ERROR') {
      console.error(output);
    } else {
      console.log(output);
    }
  }
}

export const logger = new Logger();
