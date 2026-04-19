// WASM module loader — starts preloading immediately on import,
// so the download + compile overlaps with app shell rendering.

let wasmModule: typeof import('$wasm/wallet_wasm') | null = null;
let wasmPromise: Promise<typeof import('$wasm/wallet_wasm')> | null = null;

const loadWasm = async () => {
	const mod = await import('$wasm/wallet_wasm');
	await mod.default();
	wasmModule = mod;
	return mod;
};

// Start preloading immediately — don't wait for first getWasm() call.
if (typeof window !== 'undefined') {
	wasmPromise = loadWasm();
}

export const getWasm = async () => {
	if (wasmModule) return wasmModule;
	if (!wasmPromise) wasmPromise = loadWasm();
	return wasmPromise;
};
