#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Kalpa, Logger } from '@kalpa/core';
import { loadConfig, createAdapter, createTransform } from './config.js';
import type { KalpaConfig } from './config.js';

// ─── Kalpa CLI ─────────────────────────────────────────────────────
// Usage:
//   kalpa start --config kalpa.yml
//   kalpa start --config kalpa.json
//   kalpa health --config kalpa.yml

const BANNER = `
╔═══════════════════════════════════════╗
║   कल्प  K A L P A   v0.1.0          ║
║   Universal Meta-Protocol Framework   ║
╚═══════════════════════════════════════╝
`;

async function main() {
    const { values, positionals } = parseArgs({
        options: {
            config: { type: 'string', short: 'c' },
            help: { type: 'boolean', short: 'h' },
            version: { type: 'boolean', short: 'v' },
        },
        allowPositionals: true,
    });

    if (values.version) {
        console.log('kalpa v0.1.0');
        process.exit(0);
    }

    const command = positionals[0] ?? 'start';

    if (values.help || command === 'help') {
        printHelp();
        process.exit(0);
    }

    if (command === 'start') {
        if (!values.config) {
            console.error('Error: --config <file> is required');
            console.error('Usage: kalpa start --config kalpa.yml');
            process.exit(1);
        }

        await startFromConfig(values.config);
    } else {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
}

function printHelp() {
    console.log(`
Kalpa CLI — Universal Meta-Protocol Framework

Commands:
  start    Start Kalpa with a config file
  help     Show this help message

Options:
  -c, --config <file>   Configuration file (YAML or JSON)
  -v, --version         Show version
  -h, --help            Show help

Examples:
  kalpa start --config kalpa.yml
  kalpa start -c production.json
`);
}

async function startFromConfig(configPath: string) {
    console.log(BANNER);

    const logger = new Logger({ level: 'info', context: { component: 'cli' } });

    // Load config
    let config: KalpaConfig;
    try {
        config = loadConfig(configPath);
        logger.info(`Config loaded from: ${configPath}`);
    } catch (err) {
        logger.error(`Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    // Create engine
    const kalpa = new Kalpa({ logLevel: config.logLevel ?? 'info' });

    // Register adapters
    for (const [name, definition] of Object.entries(config.adapters)) {
        try {
            const { adapter, config: adapterConfig } = await createAdapter(name, definition);
            await kalpa.register(adapter, adapterConfig);
            logger.info(`Adapter registered: ${name} (${definition.type})`);
        } catch (err) {
            logger.error(`Failed to register adapter "${name}": ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    }

    // Set up routes
    if (config.routes) {
        for (const routeDef of config.routes) {
            const transforms = routeDef.transforms?.map(t => createTransform(t));

            kalpa.route({
                id: routeDef.id ?? `route-${Math.random().toString(36).slice(2, 8)}`,
                from: {
                    protocol: routeDef.from.protocol,
                    match: routeDef.from.match,
                },
                to: {
                    protocol: routeDef.to.protocol,
                    adapter: routeDef.to.adapter,
                    action: routeDef.to.action,
                },
                priority: routeDef.priority,
                transform: transforms,
            });

            logger.info(`Route added: ${routeDef.from.protocol} → ${routeDef.to.protocol}`);
        }
    }

    // Listen for lifecycle events
    kalpa.on('kalpa:connect', (ume) => {
        logger.debug('Client connected', { source: ume.source });
    });

    kalpa.on('kalpa:disconnect', (ume) => {
        logger.debug('Client disconnected', { source: ume.source });
    });

    kalpa.on('error', (err) => {
        logger.error('Engine error', { error: err.message });
    });

    // Start
    try {
        await kalpa.start();
        logger.info('Kalpa is running');

        // Print summary
        const adapters = kalpa.getRegistry().list();
        const routes = kalpa.getRouter().getRoutes();
        console.log('\n  Adapters:');
        for (const name of adapters) {
            const adapter = kalpa.getRegistry().get(name)!;
            console.log(`    • ${name} (${adapter.protocol}) — ${adapter.capabilities.supportedClasses.join(', ')}`);
        }
        if (routes.length > 0) {
            console.log('\n  Routes:');
            for (const route of routes) {
                console.log(`    • ${route.from.protocol} → ${route.to.protocol}${route.to.action ? ` [${route.to.action}]` : ''}`);
            }
        }
        console.log('\n  Press Ctrl+C to stop\n');

    } catch (err) {
        logger.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n  Shutting down...\n');
        await kalpa.stop();
        await kalpa.destroy();
        logger.info('Kalpa stopped gracefully');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
