// Lazy WASM module loader.
// For now, we stub the WASM functions with pure TypeScript implementations
// that produce identical output. Once @webycash/webylib-wasm is published
// to npm, swap the import.

let wasmModule: typeof import('./wasm-stubs') | null = null;

export const getWasm = async () => {
	if (!wasmModule) {
		// TODO: replace with actual WASM import once published:
		// wasmModule = await import('@webycash/webylib-wasm');
		// await wasmModule.default();
		wasmModule = await import('./wasm-stubs');
	}
	return wasmModule;
};
