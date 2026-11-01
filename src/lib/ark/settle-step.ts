/**
 * Settle step of the referee MuSig2 ceremony, wired per role.
 *
 * Provider: bind (referee pubshare, own provider key, both settle nonces,
 * settle sighash) to the WASM-derived aggregate owner key Q, then produce the
 * provider partial INSIDE the WASM (ProviderPartialSign; consumes the single-use
 * secret nonce) and self-verify it before it can leave the wallet.
 *
 * Bearer seller: bind the same public inputs to Q, then (once the referee's
 * ReleaseSettle and the provider partial are delivered) verify both partials
 * and aggregate a BIP340 signature valid under Q.
 *
 * Every mismatch fails closed with ARK_SETTLE_CEREMONY_INVALID. The MuSig2
 * arithmetic (per-swap owner key, partial verification, aggregation) runs in
 * extro-node via `Op::Ark` (./ceremony, ADR-0007); this module only wires the
 * role-specific inputs.
 */
import type { WireProviderMaterial } from '@extro/node';
import { GATE_SETTLE_CEREMONY_INVALID, NamedArkGateError } from './named-gates';
import {
	aggregateSettleSignature,
	assertCeremonyMatchesOwnerKey,
	checkCeremonyInputs,
	releaseNamesLockedRef,
	verifyCeremonyPartial,
	type CeremonyInputs,
	type ReleaseSettle
} from './ceremony';
import { providerFillId, wasmProviderPartialSign } from './wasm-cosign';

/** The swap binding the 2-of-2 owner key is tweaked by (audit C1). */
export interface SwapBinding {
	swapId: string;
	requestCommitment: Uint8Array;
}

export interface PreparedRefereeShare {
	refereeMusig2Pubshare: string;
	refereeSettleNoncePub: string;
}

type MaterialKeys = Pick<
	WireProviderMaterial,
	'provider_musig2_pubkey' | 'settle_nonce_pub' | 'locked_ref' | 'tx_settle_hash_hex'
>;

const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

const invalid = (m: string) => new NamedArkGateError(`${GATE_SETTLE_CEREMONY_INVALID} (${m})`);

/** Build + bind the ceremony inputs for one funded settle (both roles share this). */
export async function settleCeremonyInputs(input: {
	prepared: PreparedRefereeShare;
	material: MaterialKeys;
	swap: SwapBinding;
	lockedRef: string;
	settleHashHex: string;
	aggregateOwnerKey: Uint8Array;
}): Promise<CeremonyInputs> {
	if (input.material.locked_ref !== input.lockedRef) throw invalid('material locked_ref differs from the funded outpoint');
	if (input.material.tx_settle_hash_hex.toLowerCase() !== input.settleHashHex.toLowerCase()) {
		throw invalid('material settle hash differs from the own settle template');
	}
	let inputs: CeremonyInputs;
	try {
		inputs = checkCeremonyInputs({
			refereePubkeyHex: input.prepared.refereeMusig2Pubshare,
			providerPubkeyHex: input.material.provider_musig2_pubkey,
			swapId: input.swap.swapId,
			requestCommitment: input.swap.requestCommitment,
			refereeNonceHex: input.prepared.refereeSettleNoncePub,
			providerNonceHex: input.material.settle_nonce_pub,
			sighashHex: input.settleHashHex
		});
	} catch (e) {
		if (e instanceof NamedArkGateError) throw e;
		throw invalid(e instanceof Error ? e.message : String(e));
	}
	await assertCeremonyMatchesOwnerKey(inputs, input.aggregateOwnerKey);
	return inputs;
}

export type ProviderPartialSigner = typeof wasmProviderPartialSign;

/** Provider: WASM partial over the settle sighash, self-verified (BIP327 PartialSigVerify). */
export async function providerSignSettle(input: {
	slot: number;
	orderIdHex: string;
	counterpartyFpHex: string;
	inputs: CeremonyInputs;
	sign?: ProviderPartialSigner;
}): Promise<string> {
	const sign = input.sign ?? wasmProviderPartialSign;
	const partial = await sign({
		slot: input.slot,
		fillId: providerFillId(input.orderIdHex, input.counterpartyFpHex),
		session: 'settle',
		refereePkHex: input.inputs.refereePubkeyHex,
		swapId: input.inputs.swapId,
		requestCommitment: input.inputs.requestCommitment,
		refereeNonceHex: input.inputs.refereeNonceHex,
		msg: hexToBytes(input.inputs.sighashHex)
	});
	await verifyCeremonyPartial(input.inputs, 'provider', partial);
	return partial;
}

/** Seller: verify referee + provider partials and aggregate the settle signature under Q. */
export async function sellerAggregateSettle(input: {
	inputs: CeremonyInputs;
	release: ReleaseSettle;
	providerPartialHex: string;
	lockedRef: string;
}): Promise<string> {
	if (!releaseNamesLockedRef(input.release.aspVtxoRef, input.lockedRef))
		throw invalid('ReleaseSettle is for a different VTXO');
	return aggregateSettleSignature(
		input.inputs,
		input.release.refereePartialHex,
		input.providerPartialHex
	);
}

/**
 * Pre-funding binding: the per-swap KeyAgg([referee pubshare, provider musig2
 * key]) must be the contract owner key before anyone locks funds into it.
 */
export async function assertOwnerKeyBinding(input: {
	refereePubkeyHex: string;
	providerPubkeyHex: string;
	swap: SwapBinding;
	aggregateOwnerKey: Uint8Array;
}): Promise<void> {
	await assertCeremonyMatchesOwnerKey(
		{
			refereePubkeyHex: input.refereePubkeyHex,
			providerPubkeyHex: input.providerPubkeyHex,
			swapId: input.swap.swapId,
			requestCommitment: input.swap.requestCommitment
		},
		input.aggregateOwnerKey
	);
}

// ── Collaborative refund (provider aggregates; referee ReleaseRefund) ────────

type RefundMaterialKeys = Pick<
	WireProviderMaterial,
	'provider_musig2_pubkey' | 'refund_nonce_pub' | 'locked_ref' | 'tx_refund_hash_hex'
>;

/** Bind the refund session: referee refund nonce + provider refund nonce over the refund bundle. */
export async function refundCeremonyInputs(input: {
	prepared: { refereeMusig2Pubshare: string; refereeRefundNoncePub: string };
	material: RefundMaterialKeys;
	swap: SwapBinding;
	lockedRef: string;
	refundHashHex: string;
	aggregateOwnerKey: Uint8Array;
}): Promise<CeremonyInputs> {
	if (input.material.locked_ref !== input.lockedRef)
		throw invalid('material locked_ref differs from the funded outpoint');
	if (input.material.tx_refund_hash_hex.toLowerCase() !== input.refundHashHex.toLowerCase()) {
		throw invalid('material refund hash differs from the own refund spend');
	}
	let inputs: CeremonyInputs;
	try {
		inputs = checkCeremonyInputs({
			refereePubkeyHex: input.prepared.refereeMusig2Pubshare,
			providerPubkeyHex: input.material.provider_musig2_pubkey,
			swapId: input.swap.swapId,
			requestCommitment: input.swap.requestCommitment,
			refereeNonceHex: input.prepared.refereeRefundNoncePub,
			providerNonceHex: input.material.refund_nonce_pub,
			sighashHex: input.refundHashHex
		});
	} catch (e) {
		if (e instanceof NamedArkGateError) throw e;
		throw invalid(e instanceof Error ? e.message : String(e));
	}
	await assertCeremonyMatchesOwnerKey(inputs, input.aggregateOwnerKey);
	return inputs;
}

/**
 * Provider refund: WASM partial with the single-use REFUND nonce, self-verified,
 * then aggregated with the referee's ReleaseRefund partial (verified first).
 */
export async function providerAggregateRefund(input: {
	slot: number;
	orderIdHex: string;
	counterpartyFpHex: string;
	inputs: CeremonyInputs;
	refereePartialHex: string;
	sign?: ProviderPartialSigner;
}): Promise<string> {
	await verifyCeremonyPartial(input.inputs, 'referee', input.refereePartialHex);
	const sign = input.sign ?? wasmProviderPartialSign;
	const partial = await sign({
		slot: input.slot,
		fillId: providerFillId(input.orderIdHex, input.counterpartyFpHex),
		session: 'refund',
		refereePkHex: input.inputs.refereePubkeyHex,
		swapId: input.inputs.swapId,
		requestCommitment: input.inputs.requestCommitment,
		refereeNonceHex: input.inputs.refereeNonceHex,
		msg: hexToBytes(input.inputs.sighashHex)
	});
	await verifyCeremonyPartial(input.inputs, 'provider', partial);
	return aggregateSettleSignature(input.inputs, input.refereePartialHex, partial);
}
