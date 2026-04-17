// WASM module loader — lazily initializes the compiled wallet-wasm package.

import type { InitOutput } from '../../../crates/wallet-wasm/pkg/wallet_wasm';

let initialized = false;

export const initWasm = async (): Promise<void> => {
	if (initialized) return;
	const mod = await import('../../../crates/wallet-wasm/pkg/wallet_wasm');
	await mod.default();
	initialized = true;
};

export const getWasm = async () => {
	await initWasm();
	return await import('../../../crates/wallet-wasm/pkg/wallet_wasm');
};
