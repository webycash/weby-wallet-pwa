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
 * Every mismatch fails closed with ARK_SETTLE_CEREMONY_INVALID.
 */
import type { WireProviderMaterial } from '$lib/extro/commands';
import { GATE_SETTLE_CEREMONY_INVALID, NamedArkGateError } from './named-gates';
import {
	aggregateSettleSignature,
	assertCeremonyMatchesOwnerKey,
	checkCeremonyInputs,
	verifyCeremonyPartial,
	type CeremonyInputs,
	type ReleaseSettle
} from './settle-ceremony';
import { providerFillId, wasmProviderPartialSign } from './wasm-cosign';

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
export function settleCeremonyInputs(input: {
	prepared: PreparedRefereeShare;
	material: MaterialKeys;
	lockedRef: string;
	settleHashHex: string;
	aggregateOwnerKey: Uint8Array;
}): CeremonyInputs {
	if (input.material.locked_ref !== input.lockedRef) throw invalid('material locked_ref differs from the funded outpoint');
	if (input.material.tx_settle_hash_hex.toLowerCase() !== input.settleHashHex.toLowerCase()) {
		throw invalid('material settle hash differs from the own settle template');
	}
	let inputs: CeremonyInputs;
	try {
		inputs = checkCeremonyInputs({
			refereePubkeyHex: input.prepared.refereeMusig2Pubshare,
			providerPubkeyHex: input.material.provider_musig2_pubkey,
			refereeNonceHex: input.prepared.refereeSettleNoncePub,
			providerNonceHex: input.material.settle_nonce_pub,
			sighashHex: input.settleHashHex
		});
	} catch (e) {
		if (e instanceof NamedArkGateError) throw e;
		throw invalid(e instanceof Error ? e.message : String(e));
	}
	assertCeremonyMatchesOwnerKey(inputs, input.aggregateOwnerKey);
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
		refereeNonceHex: input.inputs.refereeNonceHex,
		msg: hexToBytes(input.inputs.sighashHex)
	});
	verifyCeremonyPartial(input.inputs, 'provider', partial);
	return partial;
}

/** Seller: verify referee + provider partials and aggregate the settle signature under Q. */
export function sellerAggregateSettle(input: {
	inputs: CeremonyInputs;
	release: ReleaseSettle;
	providerPartialHex: string;
	lockedRef: string;
}): string {
	if (input.release.aspVtxoRef !== input.lockedRef) throw invalid('ReleaseSettle is for a different VTXO');
	return aggregateSettleSignature(input.inputs, input.release.refereePartialHex, input.providerPartialHex);
}

/**
 * Pre-funding binding: KeyAgg([referee pubshare, provider musig2 key]) must be
 * the contract owner key before anyone locks funds into it.
 */
export function assertOwnerKeyBinding(input: {
	refereePubkeyHex: string;
	providerPubkeyHex: string;
	aggregateOwnerKey: Uint8Array;
}): void {
	assertCeremonyMatchesOwnerKey(
		{
			refereePubkeyHex: input.refereePubkeyHex.toLowerCase(),
			providerPubkeyHex: input.providerPubkeyHex.toLowerCase(),
			refereeNonceHex: '',
			providerNonceHex: '',
			sighashHex: ''
		},
		input.aggregateOwnerKey
	);
}
