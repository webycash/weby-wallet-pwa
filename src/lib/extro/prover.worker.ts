// Off-main-thread Groth16 prover.
//
// `SwapInitiate` generates two real Groth16/BN254 proofs (~40k-constraint bearer
// + conditional circuits). On the UI thread that pegs the CPU for tens of
// seconds and freezes the tab. This module Web Worker boots its OWN extro-node
// wasm instance and runs the heavy commands off-thread, posting the rkyv
// `InitiateRequest` envelope bytes back. The wallet seed + proving keys live
// only inside this worker for the duration of the job.
//
// One job per worker: the caller (`prover.ts`) spawns a fresh worker, posts the
// job, awaits the single reply, then terminates it.

import { BundledExtroAdapter, type ExtroRuntimeConfig } from '@extro/node';

// A dedicated node instance for this worker, booted once with the strict
// schema-v2 config the caller passes (the same adapter the app uses).
let adapter: BundledExtroAdapter | null = null;

async function ensure(bootConfig: ExtroRuntimeConfig): Promise<BundledExtroAdapter> {
	if (!adapter) {
		const next = new BundledExtroAdapter({ bootConfig });
		await next.boot();
		adapter = next;
	}
	return adapter;
}

const rid = () => crypto.getRandomValues(new Uint8Array(16));

export interface ProveJob {
	id: string;
	mnemonic: string;
	bearerPk: Uint8Array;
	conditionalPk: Uint8Array;
	/** The TwoProofFacts JS object (see extro-node command.rs::SwapInitiate). */
	facts: unknown;
	/** Schema-v2 boot config — required; the WASM codec validates it again. */
	bootConfig: ExtroRuntimeConfig;
}

self.onmessage = async (e: MessageEvent<ProveJob>) => {
	const { id, mnemonic, bearerPk, conditionalPk, facts, bootConfig } = e.data;
	try {
		const node = await ensure(bootConfig);
		const dispatch = node.dispatch.bind(node);
		// Seed this worker's wallet, cache the proving keys, then prove.
		const imp = await dispatch({
			request_id: rid(),
			op: { kind: 'Wallet', cmd: { op: 'Import', mnemonic, passphrase: new TextEncoder().encode('extro-node-session') } }
		});
		if (imp.kind === 'Err') throw new Error(`import: ${imp.message}`);
		const ik = await dispatch({
			request_id: rid(),
			op: { kind: 'Scheme402', cmd: { op: 'InstallProofKeys', bearer_pk: bearerPk, conditional_pk: conditionalPk } }
		});
		if (ik.kind === 'Err') throw new Error(`install keys: ${ik.message}`);
		const si = await dispatch({
			request_id: rid(),
			op: { kind: 'Scheme402', cmd: { op: 'SwapInitiate', facts } }
		});
		if (si.kind === 'Ok' && si.body.kind === 'InitiateEnvelope') {
			const bytes = si.body.bytes;
			(self as unknown as Worker).postMessage({ id, ok: true, bytes }, [bytes.buffer]);
		} else {
			(self as unknown as Worker).postMessage({
				id,
				ok: false,
				error: si.kind === 'Err' ? si.message : `unexpected ${si.body.kind}`
			});
		}
	} catch (err) {
		(self as unknown as Worker).postMessage({ id, ok: false, error: `${err}` });
	}
};
