import type { UME } from './ume.js';
import { TransformError } from './errors.js';
import { Logger } from './logger.js';

// ─── Transformer Pipeline ──────────────────────────────────────────
// Composable middleware chain for UME transformation.

/**
 * A transform function takes a UME and returns a (possibly modified) UME.
 * Can be sync or async.
 */
export type TransformFn = (envelope: UME) => UME | Promise<UME>;

export class TransformerPipeline {
    private transforms: { name: string; fn: TransformFn }[] = [];
    private logger: Logger;

    constructor(logger?: Logger) {
        this.logger = logger ?? new Logger({ context: { component: 'transformer' } });
    }

    /**
     * Add a named transform to the pipeline.
     */
    use(name: string, fn: TransformFn): void {
        this.transforms.push({ name, fn });
        this.logger.debug(`Transform added: ${name}`);
    }

    /**
     * Execute the full pipeline on a UME. Transforms run in order.
     */
    async execute(envelope: UME): Promise<UME> {
        let result = envelope;

        for (const { name, fn } of this.transforms) {
            try {
                result = await fn(result);
            } catch (err) {
                throw new TransformError(
                    `Transform "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
                    name,
                );
            }
        }

        return result;
    }

    /**
     * Execute an ad-hoc list of transforms (used for per-route transforms).
     */
    async executeList(envelope: UME, transforms: TransformFn[]): Promise<UME> {
        let result = envelope;

        for (let i = 0; i < transforms.length; i++) {
            try {
                result = await transforms[i](result);
            } catch (err) {
                throw new TransformError(
                    `Inline transform [${i}] failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        return result;
    }

    /**
     * Number of transforms in the pipeline.
     */
    get size(): number {
        return this.transforms.length;
    }

    /**
     * Clear all transforms.
     */
    clear(): void {
        this.transforms = [];
    }
}

// ─── Built-in Transforms ─────────────────────────────────────────

/**
 * Inject headers into every UME passing through.
 */
export function headerInjection(headers: Record<string, any>): TransformFn {
    return (envelope: UME): UME => {
        return {
            ...envelope,
            headers: { ...envelope.headers, ...headers },
        };
    };
}
