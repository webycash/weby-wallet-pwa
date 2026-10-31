// Spent/unspent status of a public webcash token for the OG preview card.
//
// The worker never handles secrets: it receives the pre-computed public token
// (`e{amount}:public:{hash}`) from the share link. It has no rail transport of
// its own — the read is extro-node's typed `Rail(WebcashTokenStatus)` op
// (webylib wire), served by the same release WASM the wallet runs, booted
// in-memory (`storage: 'ephemeral'`: Workers have no IndexedDB).
//
// Presentation-only and fail-soft: any error, unknown token or timeout yields
// `null` and the card renders as "valid" — a preview is never a payment check.

import { BundledExtroAdapter, newRequestId, parseRuntimeConfig } from '@extro/node';

/** Webcash server base per share-link network (extro-node appends the rail path). */
export const WEBCASH_SERVERS = Object.freeze({
	production: 'https://webcash.org',
	testnet: 'https://weby.cash/api/webcash/testnet'
});

/**
 * @param {object} deps
 * @param {() => Promise<import('@extro/node').ExtroNodeWasm>} deps.load
 *   Loader for the release WASM (in the Worker: `loadExtroNodeWasm(module)`).
 * @param {() => Promise<unknown>} deps.loadConfig
 *   The deployment's schema-v2 release config (the wallet's runtime-config.json).
 * @param {number} [deps.timeoutMs]
 * @param {{ production: string, testnet: string }} [deps.servers]
 * @returns {(network: string, publicWc: string) => Promise<boolean | null>}
 */
export function createSpentChecker({ load, loadConfig, timeoutMs = 4000, servers = WEBCASH_SERVERS }) {
	/** @type {Promise<BundledExtroAdapter> | null} */
	let booting = null;
	const node = () => {
		booting ??= (async () => {
			const adapter = new BundledExtroAdapter({
				load,
				bootConfig: parseRuntimeConfig(await loadConfig()),
				storage: 'ephemeral'
			});
			await adapter.boot();
			return adapter;
		})().catch((error) => {
			booting = null; // retry on the next request
			throw error;
		});
		return booting;
	};

	return async function checkSpent(network, publicWc) {
		if (!publicWc) return null;
		const server_url = network === 'testnet' ? servers.testnet : servers.production;
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(() => resolve(null), timeoutMs);
		});
		const read = (async () => {
			const response = await (await node()).dispatch({
				request_id: newRequestId(),
				op: { kind: 'Rail', cmd: { op: 'WebcashTokenStatus', server_url, public_tokens: [publicWc] } }
			});
			if (response.kind !== 'Ok' || response.body.kind !== 'WebcashTokenStatuses') return null;
			const state = response.body.statuses[0];
			if (!state || state.public_token !== publicWc) return null;
			if (state.status === 'spent') return true;
			if (state.status === 'unspent') return false;
			return null;
		})().catch(() => null);
		try {
			return await Promise.race([read, timeout]);
		} finally {
			clearTimeout(timer);
		}
	};
}
