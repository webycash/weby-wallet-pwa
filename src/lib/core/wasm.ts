// WASM module loader — lazily initializes the compiled wallet-wasm package.

let wasmModule: typeof import('$wasm/wallet_wasm') | null = null;

export const getWasm = async () => {
	if (!wasmModule) {
		const mod = await import('$wasm/wallet_wasm');
		await mod.default();
		wasmModule = mod;
	}
	return wasmModule;
};
