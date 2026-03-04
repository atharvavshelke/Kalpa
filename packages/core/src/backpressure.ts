import type { UME } from './ume.js';

// ─── Backpressure Handling ─────────────────────────────────────────
// Bounded message queue for adapter-level flow control.

export enum BackpressureStrategy {
    /** Drop the oldest message when the queue is full */
    DROP_OLDEST = 'drop-oldest',
    /** Drop the newest (incoming) message when the queue is full */
    DROP_NEWEST = 'drop-newest',
    /** Block (apply backpressure to source) when the queue is full */
    BLOCK = 'block',
}

export interface MessageQueueOptions {
    /** Maximum number of messages in the queue */
    maxSize: number;
    /** Strategy when the queue is full */
    strategy: BackpressureStrategy;
    /** Threshold (0.0-1.0) at which to emit a warning */
    warningThreshold?: number;
}

export type BackpressureEventHandler = (info: {
    queueSize: number;
    maxSize: number;
    strategy: BackpressureStrategy;
    dropped?: UME;
}) => void;

export class MessageQueue {
    private queue: UME[] = [];
    private maxSize: number;
    private strategy: BackpressureStrategy;
    private warningThreshold: number;
    private onPressure: BackpressureEventHandler | null = null;
    private _isPaused: boolean = false;
    private _totalEnqueued: number = 0;
    private _totalDropped: number = 0;

    constructor(options: MessageQueueOptions) {
        this.maxSize = options.maxSize;
        this.strategy = options.strategy;
        this.warningThreshold = options.warningThreshold ?? 0.8;
    }

    /**
     * Add a message to the queue. Returns true if enqueued, false if dropped.
     */
    enqueue(envelope: UME): boolean {
        this._totalEnqueued++;

        if (this.queue.length >= this.maxSize) {
            switch (this.strategy) {
                case BackpressureStrategy.DROP_OLDEST: {
                    const dropped = this.queue.shift()!;
                    this.queue.push(envelope);
                    this._totalDropped++;
                    this.emitPressure(dropped);
                    return true;
                }
                case BackpressureStrategy.DROP_NEWEST: {
                    this._totalDropped++;
                    this.emitPressure(envelope);
                    return false;
                }
                case BackpressureStrategy.BLOCK: {
                    this._isPaused = true;
                    this.emitPressure();
                    return false;
                }
            }
        }

        this.queue.push(envelope);

        // Check warning threshold
        if (this.queue.length / this.maxSize >= this.warningThreshold) {
            this.emitPressure();
        }

        return true;
    }

    /**
     * Remove and return the next message from the queue.
     */
    dequeue(): UME | undefined {
        const msg = this.queue.shift();

        // Unpause if we were blocked and queue has drained below threshold
        if (this._isPaused && this.queue.length < this.maxSize * this.warningThreshold) {
            this._isPaused = false;
        }

        return msg;
    }

    /**
     * Register a handler for backpressure events.
     */
    onBackpressure(handler: BackpressureEventHandler): void {
        this.onPressure = handler;
    }

    /** Current queue size */
    get size(): number {
        return this.queue.length;
    }

    /** Whether the queue is paused (BLOCK strategy) */
    get isPaused(): boolean {
        return this._isPaused;
    }

    /** Whether the queue is at capacity */
    get isFull(): boolean {
        return this.queue.length >= this.maxSize;
    }

    /** Total messages enqueued since creation */
    get totalEnqueued(): number {
        return this._totalEnqueued;
    }

    /** Total messages dropped since creation */
    get totalDropped(): number {
        return this._totalDropped;
    }

    /** Resume processing (unpause) */
    resume(): void {
        this._isPaused = false;
    }

    /** Clear all messages */
    clear(): void {
        this.queue = [];
        this._isPaused = false;
    }

    private emitPressure(dropped?: UME): void {
        if (this.onPressure) {
            this.onPressure({
                queueSize: this.queue.length,
                maxSize: this.maxSize,
                strategy: this.strategy,
                dropped,
            });
        }
    }
}
