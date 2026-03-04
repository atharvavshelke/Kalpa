// ─── Kalpa Error Hierarchy ──────────────────────────────────────────

/**
 * Base error class for all Kalpa errors.
 */
export class KalpaError extends Error {
    public readonly code: string;

    constructor(message: string, code: string = 'KALPA_ERROR') {
        super(message);
        this.name = 'KalpaError';
        this.code = code;
        // Maintain proper prototype chain
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when an adapter encounters an error.
 */
export class AdapterError extends KalpaError {
    public readonly adapterName: string;

    constructor(message: string, adapterName: string) {
        super(message, 'ADAPTER_ERROR');
        this.name = 'AdapterError';
        this.adapterName = adapterName;
    }
}

/**
 * Thrown when a routing operation fails.
 */
export class RoutingError extends KalpaError {
    public readonly routeId?: string;

    constructor(message: string, routeId?: string) {
        super(message, 'ROUTING_ERROR');
        this.name = 'RoutingError';
        this.routeId = routeId;
    }
}

/**
 * Thrown when a transform operation fails.
 */
export class TransformError extends KalpaError {
    public readonly transformName?: string;

    constructor(message: string, transformName?: string) {
        super(message, 'TRANSFORM_ERROR');
        this.name = 'TransformError';
        this.transformName = transformName;
    }
}

/**
 * Thrown when a registry operation fails (e.g., duplicate registration).
 */
export class RegistryError extends KalpaError {
    constructor(message: string) {
        super(message, 'REGISTRY_ERROR');
        this.name = 'RegistryError';
    }
}
