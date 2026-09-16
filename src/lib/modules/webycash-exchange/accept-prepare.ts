/**
 * Dual-signed prepare orchestration for Accept→runSwap.
 *
 * Builds byte-identical ArkPrepareTerms from ProviderMaterial + runtime Ark
 * pins, exchanges SignSwapPrepare / CountersignSwapPrepare over DHTX, POSTs
 * the envelope to the pinned referee, and returns a VerifiedPreparedSwap.
 * Never invents a settled terminal — callers still must prove.
 */

import { getRuntimeConfig } from '$lib/extro/runtime-config';
import type {
	ArkPrepareExpectation,
	ArkPrepareTerms,
	WireProviderMaterial
} from '$lib/extro/commands';
import type { RefereeClient } from './referee-client';
import {
	buildSwapPrepareEnvelope,
	countersignSwapPrepare,
	fetchSwapPrepareInbox,
	relaySwapPrepareSignature,
	relaySwapPrepared,
	signSwapPrepare,
	submitAndVerifySwapPrepare,
	type VerifiedPreparedSwap
} from './swap-prepare';

const hexToBytes = (hex: string, length: number, name: string): Uint8Array => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, 'i').test(clean)) {
		throw new Error(`${name} must be exactly ${length} bytes hex`);
	}
	return Uint8Array.from({ length }, (_, i) => Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16));
};

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const randomBytes = (n: number): Uint8Array => {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	if (out.every((b) => b === 0)) out[0] = 1;
	return out;
};

/** Map runtime ark_network (`regtest`) onto prepare wire (`regtest`). */
const toPrepareNetwork = (
	network: string
): 'regtest' | 'signet' | 'bitcoin' => {
	if (network === 'regtest') return 'regtest';
	if (network === 'signet') return 'signet';
	if (network === 'bitcoin') return 'bitcoin';
	throw new Error(`unsupported ark_network=${network}`);
};

/** Pad a 16-byte DHTX order id to the 32-byte prepare order_id (16 zero ‖ 16 id). */
export function orderIdToPrepareOrderId(orderId16: Uint8Array): Uint8Array {
	if (orderId16.length !== 16) throw new Error('DHTX order id must be 16 bytes');
	const out = new Uint8Array(32);
	out.set(orderId16, 16);
	return out;
}

export type BuildPrepareTermsInput = {
	orderId16: Uint8Array;
	signedOrderCommitmentSha256: Uint8Array;
	fillAmountRaw: bigint;
	provider: WireProviderMaterial;
	bearerSellerFpHex: string;
	bearerSellerPgpPubkeyHex: string;
	bearerSellerCancelPubkeyHex: string;
	providerArkDestination: string;
	bearerSellerArkDestination: string;
	arkAmountSats?: bigint;
	ttlSeconds?: number;
	/** Absolute expiry; when set, overrides ttlSeconds-based now+ttl (needed for dual-party byte identity). */
	expiresAtUnix?: number;
	idempotencyKey?: Uint8Array;
	nonce?: Uint8Array;
};

/** Assemble ArkPrepareTerms from genuine ProviderMaterial + runtime Ark pins. */
export function buildArkPrepareTermsFromProvider(input: BuildPrepareTermsInput): ArkPrepareTerms {
	const cfg = getRuntimeConfig();
	if (!cfg.ark_enabled) {
		throw new Error('PREPARE_REQUIRES_ARK: ark_enabled=false');
	}
	const providerFp = bytesToHex(input.provider.provider_fp);
	const providerPgp = bytesToHex(input.provider.provider_pgp_pubkey);
	if (!/^([0-9a-f]{64}):(\d+)$/i.test(input.provider.locked_ref)) {
		throw new Error('provider locked_ref must be a real Ark VTXO outpoint');
	}
	const idempotencyKey = input.idempotencyKey ?? randomBytes(16);
	const nonce = input.nonce ?? randomBytes(32);
	const ttl = input.ttlSeconds ?? 300;
	return {
		order_id: orderIdToPrepareOrderId(input.orderId16),
		signed_order_commitment_sha256: input.signedOrderCommitmentSha256.slice(),
		fill_amount_raw: input.fillAmountRaw,
		parties: {
			provider_fp: providerFp,
			provider_pgp_pubkey_hex: providerPgp,
			bearer_seller_fp: input.bearerSellerFpHex.toLowerCase(),
			bearer_seller_pgp_pubkey_hex: input.bearerSellerPgpPubkeyHex.toLowerCase(),
			provider_musig2_pubkey: input.provider.provider_musig2_pubkey.toLowerCase(),
			provider_cancel_pubkey_hex: input.provider.provider_cancel_pubkey_hex.toLowerCase(),
			bearer_seller_cancel_pubkey_hex: input.bearerSellerCancelPubkeyHex.toLowerCase()
		},
		provider_nonces: {
			settle_nonce_pub: input.provider.settle_nonce_pub.toLowerCase(),
			refund_nonce_pub: input.provider.refund_nonce_pub.toLowerCase()
		},
		ark_network: toPrepareNetwork(cfg.ark_network),
		ark_operator_signer_pk: hexToBytes(cfg.ark_signer_pk_hex, 32, 'ark_signer_pk_hex'),
		ark_operator_info_digest: hexToBytes(cfg.ark_info_digest_hex, 32, 'ark_info_digest_hex'),
		ark_unilateral_exit_delay: BigInt(cfg.ark_unilateral_exit_delay),
		ark_amount_sats: input.arkAmountSats ?? 25_000n,
		provider_ark_destination: input.providerArkDestination,
		bearer_seller_ark_destination: input.bearerSellerArkDestination,
		idempotency_key: idempotencyKey,
		nonce,
		expires_at_unix: input.expiresAtUnix ?? Math.floor(Date.now() / 1000) + ttl
	};
}

export function expectationFromTerms(terms: ArkPrepareTerms): ArkPrepareExpectation {
	return {
		order_id: terms.order_id.slice(),
		signed_order_commitment_sha256: terms.signed_order_commitment_sha256.slice(),
		fill_amount_raw: terms.fill_amount_raw,
		provider_fp: terms.parties.provider_fp,
		ark_network: terms.ark_network,
		ark_operator_signer_pk: terms.ark_operator_signer_pk.slice(),
		ark_operator_info_digest: terms.ark_operator_info_digest.slice(),
		ark_unilateral_exit_delay: terms.ark_unilateral_exit_delay,
		ark_amount_sats: terms.ark_amount_sats,
		bearer_seller_ark_destination: terms.bearer_seller_ark_destination
	};
}

/** Provider (maker): sign terms and relay to bearer-seller over DHTX. */
export async function providerSignAndRelayPrepare(input: {
	terms: ArkPrepareTerms;
	orderId16: Uint8Array;
	bearerSellerFp: Uint8Array;
	slot?: number;
}): Promise<{ signed: Uint8Array; requestCommitment: Uint8Array; delivered: boolean }> {
	const signed = await signSwapPrepare(input.terms, input.slot ?? 0);
	const delivered = await relaySwapPrepareSignature({
		orderId: input.orderId16,
		forFingerprint: input.bearerSellerFp,
		role: 'Provider',
		signedPrepare: signed.signed,
		slot: input.slot
	});
	return {
		signed: signed.signed,
		requestCommitment: signed.requestCommitment,
		delivered
	};
}

/** Bearer-seller (taker): await provider sig, countersign, relay back. */
export async function bearerSellerCountersignAndRelayPrepare(input: {
	orderId16: Uint8Array;
	providerFp: Uint8Array;
	expected: ArkPrepareExpectation;
	timeoutMs?: number;
	intervalMs?: number;
	slot?: number;
}): Promise<{ signed: Uint8Array; requestCommitment: Uint8Array; providerSigned: Uint8Array }> {
	const timeoutMs = input.timeoutMs ?? 60_000;
	const intervalMs = input.intervalMs ?? 250;
	const deadline = Date.now() + timeoutMs;
	let providerSigned: Uint8Array | null = null;
	while (Date.now() < deadline) {
		const inbox = await fetchSwapPrepareInbox(input.orderId16);
		if (inbox.providerSigned) {
			providerSigned = inbox.providerSigned;
			break;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	if (!providerSigned) {
		throw new Error('RUNSWAP_NEED_PREPARE: timed out waiting for provider prepare signature');
	}
	const signed = await countersignSwapPrepare(providerSigned, input.expected, input.slot ?? 0);
	await relaySwapPrepareSignature({
		orderId: input.orderId16,
		forFingerprint: input.providerFp,
		role: 'BearerSeller',
		signedPrepare: signed.signed,
		slot: input.slot
	});
	return {
		signed: signed.signed,
		requestCommitment: signed.requestCommitment,
		providerSigned
	};
}

/** Build envelope, POST prepare, verify, optionally relay allocation. */
export async function submitDualSignedPrepare(input: {
	referee: RefereeClient;
	refereeVk: Uint8Array;
	orderId16: Uint8Array;
	forFingerprint: Uint8Array;
	providerSigned: Uint8Array;
	bearerSellerSigned: Uint8Array;
	expectedRequestCommitment: Uint8Array;
	idempotencyKey: Uint8Array;
	relay?: boolean;
	slot?: number;
}): Promise<VerifiedPreparedSwap> {
	const envelope = await buildSwapPrepareEnvelope(input.providerSigned, input.bearerSellerSigned);
	const verified = await submitAndVerifySwapPrepare({
		referee: input.referee,
		envelope,
		refereeVk: input.refereeVk,
		expectedRequestCommitment: input.expectedRequestCommitment,
		idempotencyKey: input.idempotencyKey
	});
	if (input.relay !== false) {
		await relaySwapPrepared({
			orderId: input.orderId16,
			forFingerprint: input.forFingerprint,
			signedResponse: verified.signedResponse,
			refereeVk: input.refereeVk,
			expectedRequestCommitment: input.expectedRequestCommitment,
			slot: input.slot
		});
	}
	return verified;
}

/** Poll until both party prepare signatures are in the DHTX inbox. */
export async function awaitBothPrepareSignatures(
	orderId16: Uint8Array,
	opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ providerSigned: Uint8Array; bearerSellerSigned: Uint8Array }> {
	const timeoutMs = opts.timeoutMs ?? 60_000;
	const intervalMs = opts.intervalMs ?? 250;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const inbox = await fetchSwapPrepareInbox(orderId16);
		if (inbox.providerSigned && inbox.bearerSellerSigned) {
			return {
				providerSigned: inbox.providerSigned,
				bearerSellerSigned: inbox.bearerSellerSigned
			};
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error('RUNSWAP_NEED_PREPARE: timed out waiting for dual prepare signatures');
}
