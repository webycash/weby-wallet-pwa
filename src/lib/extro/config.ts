// Runtime configuration facade. Deployed values come from the same-origin
// Worker `runtime-config.json` response and are validated before extro-node is
// loaded. There are no network/trust defaults in application code.

import type { NetworkMode } from '$lib/core/types';
import type { WireNetwork } from './commands';
import type { ExtroNodeWasm } from './bundled-node';
import { getRuntimeConfig } from './runtime-config';

export interface RailEndpoints {
	network: WireNetwork;
	esploraUrl: string;
	voucherUrl: string;
	rgbUrl: string;
	webcashUrl: string;
}

export function configuredAdapterMode(): 'bundled' {
	return getRuntimeConfig().adapter_mode;
}

export function railEndpoints(mode: NetworkMode): RailEndpoints {
	const config = getRuntimeConfig();
	const expected: NetworkMode = config.deployment === 'production' ? 'production' : 'testnet';
	if (mode !== expected) {
		throw new Error(
			`Extro rail network mismatch: deployment ${config.deployment} permits only ${expected}, got ${mode}`
		);
	}
	return {
		network: config.deployment === 'production' ? 'Bitcoin' : 'Signet',
		esploraUrl:
			config.deployment === 'production'
				? 'https://blockstream.info/api'
				: 'https://blockstream.info/signet/api',
		voucherUrl: config.voucher_server_url,
		rgbUrl: config.rgb_server_url,
		webcashUrl: config.webcash_server_url
	};
}

export async function loadBundledExtroNode(): Promise<ExtroNodeWasm> {
	const mod = (await import('$node/extro_node.js')) as unknown as {
		default: (init?: unknown) => Promise<unknown>;
	} & ExtroNodeWasm;
	await mod.default();
	return mod;
}
