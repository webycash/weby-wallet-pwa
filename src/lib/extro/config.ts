// Runtime configuration for the extro client + backend endpoints.
//
// Reads the PUBLIC_* SvelteKit env (see .env.example). This is an SSR-off SPA,
// so these resolve in the browser. The bundled extro-node WASM adapter is the
// default for real wallet ops; the mock remains the fallback for unbootable
// contexts (SSR, tests, or when the WASM artifact is absent).

import { env } from '$env/dynamic/public';
import type { ExtroMode } from './index';
import type { ExtroNodeWasm } from './bundled-node';

/** Referee (trustless-exchange mediator) base URL. */
export const REFEREE_URL: string = env.PUBLIC_REFEREE_URL ?? 'http://localhost:8090';

/** Extro keyserver (identity bootstrap + swap push) base URL. */
export const KEYSERVER_URL: string = env.PUBLIC_KEYSERVER_URL ?? 'http://localhost:7800';

/**
 * Which extro-node adapter to use. Honours `PUBLIC_EXTRO_ADAPTER`; defaults to
 * `bundled` (same-realm WASM, real wallet ops). Callers in unbootable contexts
 * should fall back to `mock` explicitly.
 */
export function configuredAdapterMode(): ExtroMode {
	const m = env.PUBLIC_EXTRO_ADAPTER;
	if (m === 'mock' || m === 'bundled' || m === 'cross-domain') return m;
	return 'bundled';
}

/**
 * Loader for the bundled extro-node WASM module. Dynamically imports the pkg
 * synced into `$node` (src/lib/node/pkg by scripts/sync-wasm.mjs) and runs its
 * wasm-bindgen `default()` init — mandatory before any export is callable. The
 * returned module satisfies {@link ExtroNodeWasm} (boot/send + codec exports).
 *
 * Kept as a dynamic import so SSR/test builds never pull the WASM in: it is only
 * invoked from the browser-only boot path.
 */
export async function loadBundledExtroNode(): Promise<ExtroNodeWasm> {
	const mod = (await import('$node/extro_node.js')) as unknown as {
		default: (init?: unknown) => Promise<unknown>;
	} & ExtroNodeWasm;
	// wasm-bindgen --target web: default() fetches + instantiates the .wasm.
	await mod.default();
	return mod;
}
