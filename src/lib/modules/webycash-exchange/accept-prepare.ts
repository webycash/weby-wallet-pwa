/**
 * Dual-signed prepare orchestration for Accept→runSwap.
 *
 * Builds byte-identical ArkPrepareTerms from ProviderMaterial + runtime Ark
 * pins, exchanges SignSwapPrepare / CountersignSwapPrepare over DHTX, POSTs
 * the envelope to the pinned referee, and returns a VerifiedPreparedSwap.
 * Never invents a settled terminal — callers still must prove.
 */

import { getExtroClient } from '$lib/extro';
import { getRuntimeConfig } from '$lib/extro/release-config';
import {
	newRequestId,
	type ArkPrepareExpectation,
	type ArkPrepareTerms,
	type BearerAssetRef,
	type ExchangeCommand,
	type ExtroResponse,
	type WireProviderMaterial
} from '@extro/node';
import type { ExtroSend } from './exchange-core';
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

const randomBytes = (n: number): Uint8Array => {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	if (out.every((b) => b === 0)) out[0] = 1;
	return out;
};

const defaultSend: ExtroSend = (c) => getExtroClient().send(c);

/**
 * Wallet expiry cap for terms it builds. The referee refuses more than 600 s
 * ahead; extro-node's provider check allows this plus 120 s of clock skew.
 */
export const PREPARE_MAX_TTL_SECS = 540;

export type BuildPrepareTermsInput = {
	orderId16: Uint8Array;
	signedOrderCommitmentSha256: Uint8Array;
	fillAmountRaw: bigint;
	/** The order's bearer asset (prepare v3; see `bearerAssetFor`). No default. */
	bearerAsset: BearerAssetRef;
	provider: WireProviderMaterial;
	/** Accept a pre-funding `offer:<dest>` provider body (terms precede funding). */
	allowOffer?: boolean;
	bearerSellerFpHex: string;
	bearerSellerPgpPubkeyHex: string;
	bearerSellerCancelPubkeyHex: string;
	providerArkDestination: string;
	bearerSellerArkDestination: string;
	/** Ark leg size from the order (no default — a hardcoded amount is a product bug). */
	arkAmountSats: bigint;
	ttlSeconds?: number;
	/** Absolute expiry; when set, overrides ttlSeconds-based now+ttl (needed for dual-party byte identity). */
	expiresAtUnix?: number;
	idempotencyKey?: Uint8Array;
	nonce?: Uint8Array;
};

/** Runtime Ark pins (config parse stays in the wallet). */
export function arkPinsFromConfig(): {
	ark_network: string;
	ark_operator_signer_pk: Uint8Array;
	ark_operator_info_digest: Uint8Array;
	ark_unilateral_exit_delay: bigint;
} {
	const cfg = getRuntimeConfig();
	return {
		ark_network: cfg.ark_network,
		ark_operator_signer_pk: hexToBytes(cfg.ark_signer_pk_hex, 32, 'ark_signer_pk_hex'),
		ark_operator_info_digest: hexToBytes(cfg.ark_info_digest_hex, 32, 'ark_info_digest_hex'),
		ark_unilateral_exit_delay: BigInt(cfg.ark_unilateral_exit_delay)
	};
}

type Body<K extends string> = Extract<Extract<ExtroResponse, { kind: 'Ok' }>['body'], { kind: K }>;

/** `Op::Exchange` prepare ops; a `PREPARE_TERMS_INVALID` refusal throws its detail. */
export async function prepareOp<K extends string>(send: ExtroSend, cmd: ExchangeCommand, kind: K): Promise<Body<K>> {
	const r = await send({ request_id: newRequestId(), op: { kind: 'Exchange', cmd } });
	if (r.kind === 'Err') {
		const m = /PREPARE_TERMS_INVALID: (.*)$/.exec(r.message);
		throw new Error(m ? m[1] : `Op::Exchange ${cmd.op}: ${r.message}`);
	}
	if (r.body.kind !== kind) throw new Error(`Op::Exchange ${cmd.op}: unexpected ${r.body.kind}`);
	return r.body as Body<K>;
}

/**
 * Canonical ArkPrepareTerms from genuine ProviderMaterial + runtime Ark pins,
 * assembled by extro-node (`Op::Exchange PrepareTerms`). The wallet supplies
 * only its randomness, its clock and the ark_enabled gate.
 */
export async function buildArkPrepare(
	input: BuildPrepareTermsInput,
	send: ExtroSend = defaultSend
): Promise<{ terms: ArkPrepareTerms; expectation: ArkPrepareExpectation; commitment: Uint8Array }> {
	if (!getRuntimeConfig().ark_enabled) {
		throw new Error('PREPARE_REQUIRES_ARK: ark_enabled=false');
	}
	const ttl = input.ttlSeconds ?? 300;
	return prepareOp(
		send,
		{
			op: 'PrepareTerms',
			input: {
				order_id: input.orderId16,
				signed_order_commitment_sha256: input.signedOrderCommitmentSha256,
				fill_amount_raw: input.fillAmountRaw,
				bearer_asset: input.bearerAsset,
				provider: input.provider,
				allow_offer: input.allowOffer === true,
				bearer_seller_fp_hex: input.bearerSellerFpHex,
				bearer_seller_pgp_pubkey_hex: input.bearerSellerPgpPubkeyHex,
				bearer_seller_cancel_pubkey_hex: input.bearerSellerCancelPubkeyHex,
				provider_ark_destination: input.providerArkDestination,
				bearer_seller_ark_destination: input.bearerSellerArkDestination,
				...arkPinsFromConfig(),
				ark_amount_sats: input.arkAmountSats,
				idempotency_key: input.idempotencyKey ?? randomBytes(16),
				nonce: input.nonce ?? randomBytes(32),
				expires_at_unix: input.expiresAtUnix ?? Math.floor(Date.now() / 1000) + ttl
			}
		},
		'ExchangePrepareTerms'
	);
}

export async function buildArkPrepareTermsFromProvider(
	input: BuildPrepareTermsInput,
	send: ExtroSend = defaultSend
): Promise<ArkPrepareTerms> {
	return (await buildArkPrepare(input, send)).terms;
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
