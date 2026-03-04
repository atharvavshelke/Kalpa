import type { UME } from './ume.js';
import type { TransformFn } from './transformer.js';
import { TransportClass, isTransportCompatible } from './transport.js';
import { RoutingError } from './errors.js';
import { Logger } from './logger.js';

// ─── Router ────────────────────────────────────────────────────────
// Pattern-aware message routing with transport class enforcement.

export interface RouteMatchCriteria {
    /** Match specific HTTP methods, topics, channels, etc. */
    [key: string]: any;
}

export interface RouteSource {
    /** Protocol name to match (e.g. "http", "websocket") */
    protocol: string;
    /** Additional match criteria */
    match?: RouteMatchCriteria;
}

export interface RouteDestination {
    /** Target protocol */
    protocol: string;
    /** Target adapter name (optional — defaults to protocol name) */
    adapter?: string;
    /** Action to perform: "forward", "broadcast", etc. */
    action?: string;
    /** Additional destination config */
    [key: string]: any;
}

export interface RouteRule {
    /** Optional route identifier */
    id?: string;
    /** Source matching criteria */
    from: RouteSource;
    /** Destination */
    to: RouteDestination;
    /** Optional transform pipeline applied to matched messages */
    transform?: TransformFn[];
    /** Optional priority (higher = checked first). Default: 0 */
    priority?: number;
}

export interface ResolvedRoute {
    /** The matched rule */
    rule: RouteRule;
    /** Which destination adapter to send to */
    adapterName: string;
}

export class Router {
    private routes: RouteRule[] = [];
    private logger: Logger;

    constructor(logger?: Logger) {
        this.logger = logger ?? new Logger({ context: { component: 'router' } });
    }

    /**
     * Add a routing rule. Optional transport class validation can be performed
     * externally when registering routes.
     */
    addRoute(rule: RouteRule): void {
        if (!rule.id) {
            rule.id = `route_${this.routes.length}`;
        }
        this.routes.push(rule);
        // Sort by priority (higher first)
        this.routes.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        this.logger.debug(`Route added: ${rule.id}`, { from: rule.from.protocol, to: rule.to.protocol });
    }

    /**
     * Remove a route by ID.
     */
    removeRoute(id: string): boolean {
        const idx = this.routes.findIndex(r => r.id === id);
        if (idx === -1) return false;
        this.routes.splice(idx, 1);
        return true;
    }

    /**
     * Resolve which routes match a given UME. Returns all matching routes.
     * This enables fan-out (one message → multiple destinations).
     */
    resolve(envelope: UME): ResolvedRoute[] {
        const matched: ResolvedRoute[] = [];

        for (const rule of this.routes) {
            if (this.matches(envelope, rule)) {
                matched.push({
                    rule,
                    adapterName: rule.to.adapter ?? rule.to.protocol,
                });
            }
        }

        return matched;
    }

    /**
     * Validate that a route is transport-class-compatible.
     * Called with actual source/destination transport classes.
     */
    validateTransportCompatibility(
        sourceClass: TransportClass,
        destClass: TransportClass,
        routeId?: string,
    ): void {
        if (!isTransportCompatible(sourceClass, destClass)) {
            throw new RoutingError(
                `Incompatible transport classes: "${sourceClass}" cannot route to "${destClass}"`,
                routeId,
            );
        }
    }

    /**
     * Get all registered routes.
     */
    getRoutes(): ReadonlyArray<RouteRule> {
        return this.routes;
    }

    // ── Private ────────────────────────────────────────────────────

    private matches(envelope: UME, rule: RouteRule): boolean {
        // Must match source protocol
        if (envelope.source.protocol !== rule.from.protocol) {
            return false;
        }

        // If additional match criteria exist, check each one
        if (rule.from.match) {
            for (const [key, value] of Object.entries(rule.from.match)) {
                const headerValue = envelope.headers[key];
                if (typeof value === 'string' && typeof headerValue === 'string') {
                    // Support glob-like wildcard matching for strings
                    if (!this.globMatch(headerValue, value)) {
                        return false;
                    }
                } else if (headerValue !== value) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Simple glob matching: supports * wildcard at the end (e.g. "/api/*")
     */
    private globMatch(value: string, pattern: string): boolean {
        if (pattern === '*') return true;
        if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -1); // Remove trailing *
            return value.startsWith(prefix) || value === prefix.slice(0, -1);
        }
        return value === pattern;
    }
}
