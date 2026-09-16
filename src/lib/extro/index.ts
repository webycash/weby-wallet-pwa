// Shipping Extro client facade. Application code has exactly one adapter: the
// release-pinned, same-origin extro-node WASM. Mock and cross-domain adapters
// remain isolated test/experimental modules and are not imported into this
// entry point or the production bundle.

import { ExtroClient } from './client';
import { BundledExtroAdapter, type BundledNodeOptions } from './bundled-node';

export { ExtroClient } from './client';
export type { ExtroAdapter, AdapterMode } from './client';
export * from './commands';

/** The sole application adapter. */
export type ExtroMode = 'bundled';

let singleton: ExtroClient | null = null;
let singletonMode: ExtroMode | null = null;

export interface ConfigureOptions {
	mode: 'bundled';
	bundled: BundledNodeOptions;
}

/**
 * Build (or rebuild) the shared same-realm facade client.
 */
export function configureExtro(options: ConfigureOptions): ExtroClient {
	const adapter = new BundledExtroAdapter(options.bundled);
	singleton = new ExtroClient(adapter);
	singletonMode = options.mode;
	return singleton;
}

/**
 * The shared facade client. Application boot must configure it explicitly.
 */
export function getExtroClient(): ExtroClient {
	if (!singleton) {
		throw new Error('Extro client is not configured; application boot must load runtime-config.json first');
	}
	return singleton;
}

/** The currently configured adapter mode. */
export function getExtroMode(): ExtroMode {
	if (!singletonMode) getExtroClient();
	return singletonMode as ExtroMode;
}

/** Test helper: drop the singleton so the next call rebuilds it. */
export function resetExtroClient(): void {
	singleton = null;
	singletonMode = null;
}
