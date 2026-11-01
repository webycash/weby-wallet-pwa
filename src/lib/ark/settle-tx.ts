/**
 * Ark settle / collaborative-refund claims for the referee 2-of-2 swap
 * contract — wallet side, as thin calls into extro-node (ADR-0007, audit H2).
 *
 * An Arkade offchain spend of one VTXO is TWO transactions: a checkpoint that
 * spends the swap VTXO through the forfeit leaf `<Q> CHECKSIGVERIFY <operator>
 * CHECKSIG`, and the ark tx that spends the checkpoint output to the
 * destination. Q signs BOTH inputs, so the referee/provider MuSig2 message is
 * the `sighash-bundle-v1` pair `[checkpoint, ark]` (64 bytes).
 *
 * Both transactions, their sighashes, the signature attachment and the
 * checkpoint co-signature are built in extro-node (`Op::Ark SwapClaims`,
 * `SignClaim`, `CosignCheckpoint`). JS only moves the resulting PSBTs to the
 * operator (`submitTx` / `finalizeTx`). No private key and no Ark transaction
 * construction exist in JS.
 */
import { newRequestId, type ExtroResponse, type WireArkClaimSet } from '@extro/node';

import { getExtroClient } from '$lib/extro';
import type { ArkSwapContract } from './swap-contract';
import { exactLockedRef, exactTxHashHex } from './provider-material';

export type ArkSpendKind = 'settle' | 'refund';

const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

const base64 = {
	encode(b: Uint8Array): string {
		let s = '';
		for (const x of b) s += String.fromCharCode(x);
		return btoa(s);
	},
	decode(text: string): Uint8Array {
		return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
	}
};

/** Tag binding a two-message bundle (mirrors referee `crypto::sighash_bundle`). */
export const SIGHASH_BUNDLE_TAG = 'webycash/ark-sighash-bundle/v1';

export interface ArkSpend {
	kind: ArkSpendKind;
	lockedRef: string;
	destination: string;
	/** BIP341 tapscript sighashes `[checkpoint input 0, ark tx input 0]`. */
	sighashes: [Uint8Array, Uint8Array];
	/** Lowercase hex of the 64-byte `[checkpoint, ark]` bundle the MuSig2 ceremony signs. */
	bundleHex: string;
	/** The exact claim set extro-node rebuilds both transactions from. */
	claims: WireArkClaimSet;
}

type Body<K extends string> = Extract<Extract<ExtroResponse, { kind: 'Ok' }>['body'], { kind: K }>;

async function arkOp<K extends string>(
	label: string,
	want: K,
	cmd: Extract<Parameters<ReturnType<typeof getExtroClient>['send']>[0]['op'], { kind: 'Ark' }>['cmd']
): Promise<Body<K>> {
	const response = await getExtroClient().send({ request_id: newRequestId(), op: { kind: 'Ark', cmd } });
	if (response.kind === 'Err') throw new Error(`${label}: ${response.message}`);
	if (response.body.kind !== want) throw new Error(`${label}: unexpected ${response.body.kind}`);
	return response.body as Body<K>;
}

/** sighash-bundle-v1 binding digest (N=2): SHA256(tag || h0 || h1), via extro-node. */
export async function sighashBundleBinding(bundle: Uint8Array): Promise<Uint8Array> {
	const body = await arkOp('SighashBundleBinding', 'ArkBundleBinding', {
		op: 'SighashBundleBinding',
		sighash_hex: bytesToHex(bundle)
	});
	return body.binding.slice();
}

/** The claim set both terminal claims of `contract`'s funded VTXO `lockedRef` are built from. */
export function arkClaimSet(contract: ArkSwapContract, lockedRef: string): WireArkClaimSet {
	const { plan } = contract;
	return {
		referee_pubkey_hex: plan.refereePubkeyHex,
		provider_pubkey_hex: plan.providerPubkeyHex,
		swap_id: plan.swapId,
		request_commitment: plan.requestCommitment.slice(),
		operator: contract.operator,
		operator_info_digest: plan.operatorInfoDigest.slice(),
		operator_signer_pk: plan.operatorSignerKey.slice(),
		network: plan.network,
		exit_delay: plan.unilateralExitDelay,
		locked_ref: exactLockedRef(lockedRef),
		amount_sats: plan.amountSats,
		settle_destination: plan.bearerSellerDestination,
		refund_destination: plan.providerDestination
	};
}

const spendOf = (kind: ArkSpendKind, claims: WireArkClaimSet, bundleHex: string): ArkSpend => {
	const hex = exactTxHashHex(bundleHex, kind === 'settle' ? 'tx_settle_hash' : 'tx_refund_hash');
	if (hex.length !== 128) throw new Error(`${kind} sighash bundle must be [checkpoint, ark]`);
	const b = hexToBytes(hex);
	return {
		kind,
		lockedRef: claims.locked_ref,
		destination: kind === 'settle' ? claims.settle_destination : claims.refund_destination,
		sighashes: [b.slice(0, 32), b.slice(32)],
		bundleHex: hex,
		claims
	};
};

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

/**
 * Submit + finalize the spend with the aggregated Q signatures. extro-node
 * verifies the signatures under Q, attaches them, and (after `submitTx`)
 * verifies the operator's checkpoint signature before adding Q's. Returns the
 * Ark txid.
 */
export async function submitArkSpend(input: {
	spend: ArkSpend;
	/** Kept for the transport contract; Q is re-derived and checked in extro-node. */
	qXonly?: Uint8Array;
	aggregateSigsHex: string;
	provider: ArkSubmitProvider;
}): Promise<string> {
	splitAggregateBundle(input.aggregateSigsHex);
	const kind = input.spend.kind === 'settle' ? 'Settle' : 'Refund';
	const signatures_hex = input.aggregateSigsHex.toLowerCase();
	const signed = await arkOp('SignClaim', 'ArkSignedClaim', {
		op: 'SignClaim',
		claims: input.spend.claims,
		kind,
		signatures_hex
	});
	const submitted = await input.provider.submitTx(base64.encode(signed.ark_psbt), [
		base64.encode(signed.checkpoint_psbt)
	]);
	if (submitted.arkTxid.toLowerCase() !== signed.ark_txid.toLowerCase()) {
		throw new Error('Ark operator accepted a different ark transaction than the one signed');
	}
	if (submitted.signedCheckpointTxs.length !== 1) {
		throw new Error(`Ark operator returned ${submitted.signedCheckpointTxs.length} checkpoints, expected 1`);
	}
	const cosigned = await arkOp('CosignCheckpoint', 'ArkCheckpoint', {
		op: 'CosignCheckpoint',
		claims: input.spend.claims,
		kind,
		signatures_hex,
		checkpoint_psbt: base64.decode(submitted.signedCheckpointTxs[0])
	});
	await input.provider.finalizeTx(submitted.arkTxid, [base64.encode(cosigned.checkpoint_psbt)]);
	return signed.ark_txid.toLowerCase();
}

/**
 * Funding refs from the REAL Arkade spends (`Op::Ark SwapClaims`):
 * `tx_settle_hash` / `tx_refund_hash` are the 64-byte `[checkpoint, ark]`
 * sighash bundles of the settle (to the bearer-seller) and collaborative-refund
 * (to the provider) transactions.
 */
export async function fundingRefsFromSpends(
	contract: ArkSwapContract,
	lockedRef: string
): Promise<{ lockedRef: string; txSettleHashHex: string; txRefundHashHex: string; settle: ArkSpend; refund: ArkSpend }> {
	const claims = arkClaimSet(contract, lockedRef);
	const body = await arkOp('SwapClaims', 'ArkSwapClaims', { op: 'SwapClaims', claims });
	const settle = spendOf('settle', claims, body.settle_bundle_hex);
	const refund = spendOf('refund', claims, body.refund_bundle_hex);
	if (settle.bundleHex === refund.bundleHex) throw new Error('settle and refund sighashes must differ');
	return {
		lockedRef: claims.locked_ref,
		txSettleHashHex: settle.bundleHex,
		txRefundHashHex: refund.bundleHex,
		settle,
		refund
	};
}
