// Main-thread entry to the off-thread Groth16 prover ({@link ./prover.worker}).
//
// Spawns a fresh module Worker, posts one `SwapInitiate` job, awaits the single
// reply (the rkyv `InitiateRequest` envelope bytes the PWA POSTs to the referee
// `/v1/swap/initiate`), then terminates the worker. Proving runs off the UI
// thread, so the tab stays responsive through the tens-of-seconds proof
// generation.

export interface ProveSwapArgs {
	mnemonic: string;
	bearerPk: Uint8Array;
	conditionalPk: Uint8Array;
	/** TwoProofFacts JS object (see extro-node SwapInitiate). */
	facts: unknown;
}

/** Generate the two-proof initiate envelope off-thread. Resolves to the rkyv
 * bytes, or rejects with the prover's error. */
export function proveSwapInitiate(args: ProveSwapArgs): Promise<Uint8Array> {
	const worker = new Worker(new URL('./prover.worker.ts', import.meta.url), { type: 'module' });
	const id = `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
	return new Promise<Uint8Array>((resolve, reject) => {
		worker.onmessage = (e: MessageEvent) => {
			if (e.data?.id !== id) return;
			worker.terminate();
			if (e.data.ok) resolve(e.data.bytes as Uint8Array);
			else reject(new Error(e.data.error));
		};
		worker.onerror = (err) => {
			worker.terminate();
			reject(new Error(`prover worker: ${err.message}`));
		};
		worker.postMessage({ id, ...args });
	});
}
