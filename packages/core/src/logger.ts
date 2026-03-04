// ─── Structured Logger ─────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    context?: Record<string, any>;
}

export interface LoggerOptions {
    /** Minimum log level to output */
    level?: LogLevel;
    /** Static context attached to every log entry */
    context?: Record<string, any>;
    /** Custom output function (defaults to console) */
    output?: (entry: LogEntry) => void;
}

export class Logger {
    private level: number;
    private context: Record<string, any>;
    private output: (entry: LogEntry) => void;

    constructor(options: LoggerOptions = {}) {
        this.level = LOG_LEVELS[options.level ?? 'info'];
        this.context = options.context ?? {};
        this.output = options.output ?? Logger.defaultOutput;
    }

    /**
     * Create a child logger with additional context.
     */
    child(context: Record<string, any>): Logger {
        return new Logger({
            level: this.levelName(),
            context: { ...this.context, ...context },
            output: this.output,
        });
    }

    debug(message: string, context?: Record<string, any>): void {
        this.log('debug', message, context);
    }

    info(message: string, context?: Record<string, any>): void {
        this.log('info', message, context);
    }

    warn(message: string, context?: Record<string, any>): void {
        this.log('warn', message, context);
    }

    error(message: string, context?: Record<string, any>): void {
        this.log('error', message, context);
    }

    private log(level: LogLevel, message: string, context?: Record<string, any>): void {
        if (LOG_LEVELS[level] < this.level) return;

        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date().toISOString(),
            context: { ...this.context, ...context },
        };

        this.output(entry);
    }

    private levelName(): LogLevel {
        const entries = Object.entries(LOG_LEVELS);
        const match = entries.find(([, value]) => value === this.level);
        return (match?.[0] as LogLevel) ?? 'info';
    }

    private static defaultOutput(entry: LogEntry): void {
        const ctx = entry.context && Object.keys(entry.context).length > 0
            ? ` ${JSON.stringify(entry.context)}`
            : '';
        const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;

        switch (entry.level) {
            case 'error':
                console.error(`${prefix} ${entry.message}${ctx}`);
                break;
            case 'warn':
                console.warn(`${prefix} ${entry.message}${ctx}`);
                break;
            case 'debug':
                console.debug(`${prefix} ${entry.message}${ctx}`);
                break;
            default:
                console.log(`${prefix} ${entry.message}${ctx}`);
        }
    }
}
