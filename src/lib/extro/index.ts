// Extro client facade — public entry point for the exchange module.
//
// The exchange module talks ONLY to this facade; it never imports a generic
// Extro wire type or touches `extro_node_send` directly. Three adapters back
// the facade:
//
//   * mock         — deterministic in-memory; DEFAULT for dev/tests.
//   * bundled      — same-realm Webycash-branded extro-node WASM; SHIPPING
//                    default mode (codec + artifact wiring deferred).
//   * cross-domain — extro.network bridge; NOT production-ready (blocked on the
//                    H4 CapToken issuer-pin).
//
// All three are wrapped by {@link ExtroClient}, which enforces single-flight
// dispatch (F-PWA-1): at most one `extro_node_send` is ever in flight, because
// extro-node holds a `RefCell` borrow across the whole dispatch and a concurrent
// send would panic.

import { ExtroClient, type AdapterMode } from './client';
import { MockExtroAdapter } from './mock-node';
import { BundledExtroAdapter, type BundledNodeOptions } from './bundled-node';
import { CrossDomainExtroAdapter, type CrossDomainOptions } from './cross-domain-node';

export { ExtroClient } from './client';
export type { ExtroAdapter, AdapterMode } from './client';
export * from './commands';
export { MockExtroAdapter, makeGate } from './mock-node';

/**
 * Which adapter the app uses. `mock` is the dev/test default; `bundled`
 * (same-realm) is the shipping default. `cross-domain` is opt-in and
 * pre-production.
 */
export type ExtroMode = AdapterMode;

let singleton: ExtroClient | null = null;
let singletonMode: ExtroMode | null = null;

export interface ConfigureOptions {
	mode: ExtroMode;
	bundled?: BundledNodeOptions;
	crossDomain?: CrossDomainOptions;
}

/**
 * Build (or rebuild) the shared facade client for `mode`. Reconfiguring with a
 * different mode replaces the singleton.
 */
export function configureExtro(options: ConfigureOptions): ExtroClient {
	const adapter = (() => {
		switch (options.mode) {
			case 'mock':
				return new MockExtroAdapter();
			case 'bundled':
				return new BundledExtroAdapter(options.bundled ?? {});
			case 'cross-domain':
				if (!options.crossDomain)
					throw new Error('cross-domain mode requires crossDomain options');
				return new CrossDomainExtroAdapter(options.crossDomain);
		}
	})();
	singleton = new ExtroClient(adapter);
	singletonMode = options.mode;
	return singleton;
}

/**
 * The shared facade client. Defaults to the MOCK adapter the first time it is
 * requested, so the exchange module is always usable without explicit wiring
 * (the integration of the bundled/cross-domain transports is staged).
 */
export function getExtroClient(): ExtroClient {
	if (!singleton) configureExtro({ mode: 'mock' });
	return singleton!;
}

/** The currently configured adapter mode (`mock` until configured). */
export function getExtroMode(): ExtroMode {
	if (!singletonMode) getExtroClient();
	return singletonMode!;
}

/** Test helper: drop the singleton so the next call rebuilds it. */
export function resetExtroClient(): void {
	singleton = null;
	singletonMode = null;
}
