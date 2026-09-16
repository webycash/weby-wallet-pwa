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

import { encodeCommand, decodeResponse, DISPATCH_ERR } from './codec';
import type { ExtroCommand, ExtroResponse } from './commands';

/** The wasm surface this worker drives — same exports the bundled adapter uses. */
interface NodeWasm {
	default: (init?: unknown) => Promise<unknown>;
	extro_node_boot(config: Uint8Array): Promise<unknown>;
	extro_node_send(msg: Uint8Array): Promise<Uint8Array>;
	extro_encode_command(command: unknown): Uint8Array;
	extro_decode_response(bytes: Uint8Array): unknown;
}

let wasm: NodeWasm | null = null;

/** Boot a dedicated wasm instance once per worker. */
async function ensure(): Promise<NodeWasm> {
	if (wasm) return wasm;
	// Inline loader (do NOT import ./config — it pulls $env, unavailable here).
	const mod = (await import('$node/extro_node.js')) as unknown as NodeWasm;
	await mod.default();
	await mod.extro_node_boot(new Uint8Array(0));
	wasm = mod;
	return mod;
}

async function dispatch(cmd: ExtroCommand): Promise<ExtroResponse> {
	const w = await ensure();
	const bytes = encodeCommand(w, cmd);
	const framed = await w.extro_node_send(bytes);
	const status = framed[0];
	const response = decodeResponse(w, framed.subarray(1));
	if (status === DISPATCH_ERR && response.kind !== 'Err') {
		return { kind: 'Err', request_id: cmd.request_id, code: 'Internal', message: 'framed status/body mismatch' };
	}
	return response;
}

const rid = () => crypto.getRandomValues(new Uint8Array(16));

export interface ProveJob {
	id: string;
	mnemonic: string;
	bearerPk: Uint8Array;
	conditionalPk: Uint8Array;
	/** The TwoProofFacts JS object (see extro-node command.rs::SwapInitiate). */
	facts: unknown;
}

self.onmessage = async (e: MessageEvent<ProveJob>) => {
	const { id, mnemonic, bearerPk, conditionalPk, facts } = e.data;
	try {
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
