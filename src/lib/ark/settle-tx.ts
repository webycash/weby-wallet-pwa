/**
 * Real Ark spend construction for the referee 2-of-2 (`webycash-musig2-v2`).
 *
 * Replaces the canonical-text template digest with the sighashes arkd actually
 * verifies. An Arkade offchain spend of one VTXO is TWO transactions
 * (`@arkade-os/sdk` `buildOffchainTx`):
 *
 *   checkpoint: spends the locked VTXO via the collaborative (forfeit) leaf
 *               `[Q, operator]` into a checkpoint output `[serverUnroll, forfeit]`;
 *   ark tx:     spends the checkpoint output via the same forfeit leaf to the
 *               destination (+ the P2A anchor).
 *
 * Q must sign BOTH inputs, so the referee/provider MuSig2 message is the
 * `sighash-bundle-v1` pair `[checkpoint, ark]` (64 bytes). Both sighashes are
 * fully determined before submission (the checkpoint txid depends only on the
 * VTXO, the forfeit leaf and the pinned server unroll script), so the ceremony
 * can sign them ahead of time and {@link presignedIdentity} just inserts the
 * aggregated BIP340 signatures when the SDK asks the "identity" to sign
 * (`signAndSubmitOffchainTx`). No private key exists in JS.
 */
import {
	ArkAddress,
	CSVMultisigTapscript,
	MultisigTapscript,
	buildOffchainTx,
	signAndSubmitOffchainTx,
	type ArkTxInput,
	type OffchainTx,
	type Transaction
} from '@arkade-os/sdk';
import { SigHash } from '@scure/btc-signer';
import { tapLeafHash } from '@scure/btc-signer/payment.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import type { ArkSwapContract } from './swap-contract';
import { exactLockedRef, exactTxHashHex } from './provider-material';

export type ArkSpendKind = 'settle' | 'refund';

const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

/** Tag binding a two-message bundle (mirrors referee `crypto::sighash_bundle`). */
export const SIGHASH_BUNDLE_TAG = 'webycash/ark-sighash-bundle/v1';

export interface ArkSpend {
	kind: ArkSpendKind;
	lockedRef: string;
	destination: string;
	offchain: OffchainTx;
	/** BIP341 tapscript sighashes `[checkpoint input 0, ark tx input 0]`. */
	sighashes: [Uint8Array, Uint8Array];
	/** Lowercase hex of the 64-byte `[checkpoint, ark]` bundle the MuSig2 ceremony signs. */
	bundleHex: string;
	/** Forfeit leaf hash (`[Q, operator]`) both inputs spend through. */
	leafHash: Uint8Array;
	inputs: ArkTxInput[];
	outputs: { amount: bigint; script: Uint8Array }[];
	serverUnrollScript: CSVMultisigTapscript.Type;
}

/** Decode the pinned `ark_checkpoint_tapscript_hex` (arkd `checkpointTapscript`). */
export function serverUnrollScriptFromHex(hex: string): CSVMultisigTapscript.Type {
	if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error('ark_checkpoint_tapscript_hex is not hex');
	return CSVMultisigTapscript.decode(hexToBytes(hex));
}

/** The collaborative `[Q, operator]` leaf of the swap contract. */
export function forfeitLeaf(contract: ArkSwapContract) {
	const script = MultisigTapscript.encode({
		pubkeys: [contract.plan.aggregateOwnerKey, contract.plan.operatorSignerKey]
	}).script;
	return contract.script.findLeaf(bytesToHex(script));
}

function leafOf(tx: Transaction, idx: number): { script: Uint8Array; version: number } {
	const leaves = tx.getInput(idx).tapLeafScript;
	if (!leaves || leaves.length !== 1) throw new Error(`input ${idx} must carry exactly one tapLeafScript`);
	const withVersion = leaves[0][1];
	return { script: withVersion.subarray(0, -1), version: withVersion[withVersion.length - 1] };
}

/** BIP341 SIGHASH_DEFAULT script-path sighash for `tx` input `idx` (the message Q signs). */
export function tapscriptSighash(tx: Transaction, idx: number): Uint8Array {
	const scripts: Uint8Array[] = [];
	const amounts: bigint[] = [];
	for (let i = 0; i < tx.inputsLength; i++) {
		const u = tx.getInput(i).witnessUtxo;
		if (!u) throw new Error(`input ${i} is missing witnessUtxo`);
		scripts.push(u.script);
		amounts.push(u.amount);
	}
	const { script, version } = leafOf(tx, idx);
	return tx.preimageWitnessV1(idx, scripts, SigHash.DEFAULT, amounts, undefined, script, version);
}

/** sighash-bundle-v1 binding digest (N=2): SHA256(tag || h0 || h1). */
export async function sighashBundleBinding(bundle: Uint8Array): Promise<Uint8Array> {
	if (bundle.length === 32) return bundle.slice();
	if (bundle.length !== 64) throw new Error('sighash bundle must be 32 or 64 bytes');
	const tag = new TextEncoder().encode(SIGHASH_BUNDLE_TAG);
	const buf = new Uint8Array(tag.length + 64);
	buf.set(tag, 0);
	buf.set(bundle, tag.length);
	return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/**
 * Build the exact checkpoint + ark tx for a settle (to the bearer-seller) or a
 * collaborative refund (to the provider) of the funded swap VTXO.
 */
export function buildArkSpend(input: {
	contract: ArkSwapContract;
	lockedRef: string;
	kind: ArkSpendKind;
	checkpointTapscriptHex: string;
}): ArkSpend {
	const lockedRef = exactLockedRef(input.lockedRef);
	const [txid, voutStr] = lockedRef.split(':');
	const { plan } = input.contract;
	const destination = input.kind === 'settle' ? plan.bearerSellerDestination : plan.providerDestination;
	const dest = ArkAddress.decode(destination);
	if (bytesToHex(dest.serverPubKey) !== bytesToHex(plan.operatorSignerKey)) {
		throw new Error(`${input.kind} destination belongs to a different Ark operator`);
	}
	const tapLeafScript = forfeitLeaf(input.contract);
	const inputs: ArkTxInput[] = [
		{ txid, vout: Number(voutStr), value: Number(plan.amountSats), tapLeafScript, tapTree: input.contract.tapTree }
	];
	const outputs = [{ amount: plan.amountSats, script: dest.pkScript }];
	const serverUnrollScript = serverUnrollScriptFromHex(input.checkpointTapscriptHex);
	const offchain = buildOffchainTx(inputs, outputs, serverUnrollScript);
	if (offchain.checkpoints.length !== 1) throw new Error('expected exactly one checkpoint');
	const sighashes: [Uint8Array, Uint8Array] = [
		tapscriptSighash(offchain.checkpoints[0], 0),
		tapscriptSighash(offchain.arkTx, 0)
	];
	const { script, version } = leafOf(offchain.arkTx, 0);
	const cp = leafOf(offchain.checkpoints[0], 0);
	if (bytesToHex(cp.script) !== bytesToHex(script)) throw new Error('checkpoint and ark tx leaves differ');
	const bundle = new Uint8Array(64);
	bundle.set(sighashes[0], 0);
	bundle.set(sighashes[1], 32);
	return {
		kind: input.kind,
		lockedRef,
		destination,
		offchain,
		sighashes,
		bundleHex: bytesToHex(bundle),
		leafHash: tapLeafHash(script, version),
		inputs,
		outputs,
		serverUnrollScript
	};
}

/**
 * A signing "identity" that never holds a key: it inserts the precomputed
 * aggregate signatures under Q for exactly the two known sighashes and refuses
 * anything else (fail closed on any tx mutation).
 */
export function presignedIdentity(input: { qXonly: Uint8Array; sighashes: Uint8Array[]; signatures: Uint8Array[] }): {
	sign(tx: Transaction, inputIndexes?: number[]): Promise<Transaction>;
} {
	if (input.sighashes.length !== input.signatures.length) throw new Error('sighash/signature count mismatch');
	const bySighash = new Map<string, Uint8Array>();
	input.sighashes.forEach((h, i) => {
		const sig = input.signatures[i];
		if (sig.length !== 64 || !schnorr.verify(sig, h, input.qXonly)) {
			throw new Error(`aggregate signature ${i} does not verify under Q`);
		}
		bySighash.set(bytesToHex(h), sig);
	});
	return {
		async sign(tx, inputIndexes) {
			const out = tx.clone();
			const idxs = inputIndexes ?? Array.from({ length: out.inputsLength }, (_, i) => i);
			for (const idx of idxs) {
				const h = bytesToHex(tapscriptSighash(out, idx));
				const sig = bySighash.get(h);
				if (!sig) throw new Error(`no presigned signature for input ${idx} (sighash ${h.slice(0, 12)}…)`);
				const { script, version } = leafOf(out, idx);
				const existing = out.getInput(idx).tapScriptSig ?? [];
				out.updateInput(idx, {
					tapScriptSig: [...existing, [{ pubKey: input.qXonly, leafHash: tapLeafHash(script, version) }, sig]]
				});
			}
			return out;
		}
	};
}

/** Split the 128-byte aggregate bundle `[sig_checkpoint, sig_ark]`. */
export function splitAggregateBundle(sigsHex: string): [Uint8Array, Uint8Array] {
	if (!/^[0-9a-f]{256}$/i.test(sigsHex)) throw new Error('aggregate bundle must be 2 x 64-byte signatures');
	const b = hexToBytes(sigsHex);
	return [b.slice(0, 64), b.slice(64)];
}

export interface ArkSubmitProvider {
	submitTx(
		signedArkTx: string,
		checkpointTxs: string[]
	): Promise<{ arkTxid: string; finalArkTx?: string; signedCheckpointTxs: string[] }>;
	finalizeTx(arkTxid: string, finalCheckpointTxs: string[]): Promise<void>;
}

/** Submit + finalize the spend with the aggregated Q signatures. Returns the Ark txid. */
export async function submitArkSpend(input: {
	spend: ArkSpend;
	qXonly: Uint8Array;
	aggregateSigsHex: string;
	provider: ArkSubmitProvider;
}): Promise<string> {
	const sigs = splitAggregateBundle(input.aggregateSigsHex);
	const identity = presignedIdentity({ qXonly: input.qXonly, sighashes: input.spend.sighashes, signatures: sigs });
	return signAndSubmitOffchainTx({
		identity,
		provider: input.provider,
		inputs: input.spend.inputs,
		outputs: input.spend.outputs,
		serverUnrollScript: input.spend.serverUnrollScript,
		verifyServerSignatures: { serverPubkey: inputPlanOperator(input.spend) }
	});
}

function inputPlanOperator(spend: ArkSpend): Uint8Array {
	// The forfeit leaf is `[Q, operator]`; the operator key is its second pubkey.
	const leaf = MultisigTapscript.decode(leafOf(spend.offchain.arkTx, 0).script);
	return leaf.params.pubkeys[1];
}

/**
 * Funding refs from the REAL Arkade spends: `tx_settle_hash` / `tx_refund_hash`
 * are the 64-byte `[checkpoint, ark]` sighash bundles of the settle (to the
 * bearer-seller) and collaborative-refund (to the provider) transactions.
 */
export function fundingRefsFromSpends(
	contract: ArkSwapContract,
	lockedRef: string,
	checkpointTapscriptHex: string
): { lockedRef: string; txSettleHashHex: string; txRefundHashHex: string; settle: ArkSpend; refund: ArkSpend } {
	const settle = buildArkSpend({ contract, lockedRef, kind: 'settle', checkpointTapscriptHex });
	const refund = buildArkSpend({ contract, lockedRef, kind: 'refund', checkpointTapscriptHex });
	if (settle.bundleHex === refund.bundleHex) throw new Error('settle and refund sighashes must differ');
	return {
		lockedRef: settle.lockedRef,
		txSettleHashHex: exactTxHashHex(settle.bundleHex, 'tx_settle_hash'),
		txRefundHashHex: exactTxHashHex(refund.bundleHex, 'tx_refund_hash'),
		settle,
		refund
	};
}
