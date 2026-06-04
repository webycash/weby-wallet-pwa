// Runtime configuration for the extro client + backend endpoints.
//
// Reads the PUBLIC_* SvelteKit env (see .env.example). This is an SSR-off SPA,
// so these resolve in the browser. The bundled extro-node WASM adapter is the
// default for real wallet ops; the mock remains the fallback for unbootable
// contexts (SSR, tests, or when the WASM artifact is absent).

import { env } from '$env/dynamic/public';
import type { ExtroMode } from './index';
import type { ExtroNodeWasm } from './bundled-node';
import type { NetworkMode } from '$lib/core/types';
import type { WireNetwork } from './commands';

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

// ── Rail endpoint config (Op::Rail server URLs + chain selector) ─────────────
//
// The PWA's NetworkMode is binary (`production | testnet`); WireNetwork has four
// arms. We map `testnet → Signet` (the task's local-stack convention — signet is
// the public testnet with a CORS-open esplora) and `production → Bitcoin`.
//
// Every URL is overridable via PUBLIC_* env so an operator can repoint at a
// different stack without a rebuild. Defaults: testnet → the local CORS-open
// rail stack (webcash :8181, rgb :8182, voucher :8183) + blockstream signet
// esplora; production → the public production servers + blockstream mainnet.

/** Bundle of rail endpoints + the chain selector for a given NetworkMode. */
export interface RailEndpoints {
	/** `Op::Rail` chain selector. */
	network: WireNetwork;
	/** Esplora base URL (must be CORS-open for the in-browser fetch bridge). */
	esploraUrl: string;
	/** Voucher-server base URL (`POST /api/v1/*`). */
	voucherUrl: string;
	/** RGB-server base URL. */
	rgbUrl: string;
	/** Webcash-server base URL (reserved for webcash rail ops). */
	webcashUrl: string;
}

const RAIL_DEFAULTS: Record<NetworkMode, RailEndpoints> = {
	testnet: {
		network: 'Signet',
		esploraUrl: 'https://blockstream.info/signet/api',
		voucherUrl: 'http://localhost:8183',
		rgbUrl: 'http://localhost:8182',
		webcashUrl: 'http://localhost:8181'
	},
	production: {
		network: 'Bitcoin',
		esploraUrl: 'https://blockstream.info/api',
		voucherUrl: 'https://voucher.weby.cash',
		rgbUrl: 'https://rgb.weby.cash',
		webcashUrl: 'https://webcash.weby.cash'
	}
};

/**
 * Resolve the rail endpoints for `mode`, applying any PUBLIC_* overrides on top
 * of the per-mode defaults. The env keys are mode-suffixed so production and
 * testnet can be configured independently in one `.env`.
 */
export function railEndpoints(mode: NetworkMode): RailEndpoints {
	const d = RAIL_DEFAULTS[mode];
	const suffix = mode === 'testnet' ? 'TESTNET' : 'PRODUCTION';
	const pick = (key: string, fallback: string): string =>
		env[`PUBLIC_RAIL_${suffix}_${key}` as keyof typeof env] ?? fallback;
	return {
		network: d.network,
		esploraUrl: pick('ESPLORA_URL', d.esploraUrl),
		voucherUrl: pick('VOUCHER_URL', d.voucherUrl),
		rgbUrl: pick('RGB_URL', d.rgbUrl),
		webcashUrl: pick('WEBCASH_URL', d.webcashUrl)
	};
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
