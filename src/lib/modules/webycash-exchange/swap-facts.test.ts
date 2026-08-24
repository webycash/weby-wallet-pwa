import { describe, expect, it } from 'vitest';

import type { LimitOrder } from './types';
import {
	buildSwapInitiateFacts,
	type BearerLeg,
	type BearerSellerIdentity,
	type PreparedSwapBinding,
	type ProviderMaterial
} from './swap-facts';

const makerFingerprint = '11'.repeat(20);
const providerPubkey = '02' + '22'.repeat(32);
const publicNonce = '02' + '33'.repeat(32) + '03' + '44'.repeat(32);

const order: LimitOrder = {
	id: '55'.repeat(16),
	pair: { base: 'BitcoinArk', quote: 'Webcash' },
	side: 'sell',
	price: 1,
	amount: 1,
	makerFingerprint,
	makerVk: '66'.repeat(32),
	expiresAt: 4_000_000_000,
	observedAt: 2_000_000_000,
	source: 'dhtx',
	signedCommitment: 'signed'
};

const bearer: BearerLeg = {
	publicTokenHash: new Uint8Array(32).fill(0x77),
	bearerAmount: '1',
	fillAmountRaw: 1n
};

const bearerSeller: BearerSellerIdentity = {
	bearer_seller_fp: '88'.repeat(20),
	bearer_seller_pgp_pubkey: '99'.repeat(32),
	bearer_seller_cancel_pubkey_hex: 'aa'.repeat(32)
};

const conditionalPayload = (): Uint8Array => {
	const payload = new Uint8Array(128);
	const ciphertext = new Uint8Array(64).fill(0xbb);
	new DataView(payload.buffer).setUint32(0, ciphertext.length, false);
	payload.set(ciphertext, 4);
	return payload;
};

const provider = (): ProviderMaterial => ({
	musig2_pubkey: providerPubkey,
	settle_nonce: publicNonce,
	refund_nonce: publicNonce,
	provider_fp: makerFingerprint,
	provider_pgp_pubkey: 'cc'.repeat(32),
	provider_cancel_pubkey_hex: 'dd'.repeat(32),
	locked_ref: `${'ee'.repeat(32)}:0`,
	tx_settle_hash_hex: '12'.repeat(32),
	tx_refund_hash_hex: '34'.repeat(32),
	conditional_payload: conditionalPayload()
});

const encryptedSecret = (): Uint8Array => new Uint8Array(80).fill(0xab);
const prepared = (): PreparedSwapBinding => ({
	swapId: 'prepared-fixture',
	requestCommitment: new Uint8Array(32).fill(0x41),
	idempotencyKey: new Uint8Array(16).fill(0x42),
	expiresAtUnix: 4_000_000_000n
});

describe('buildSwapInitiateFacts fail-closed boundary', () => {
	it('accepts a complete, internally consistent prepared-contract shape', () => {
		const facts = buildSwapInitiateFacts({
			order,
			bearer,
			provider: provider(),
			bearerSeller,
			encSecretForProvider: encryptedSecret(),
			prepared: prepared()
		});

		expect(facts.prepared_swap_id).toBe('prepared-fixture');
		expect(facts.prepare_request_commitment).toEqual(new Uint8Array(32).fill(0x41));
		expect(facts.idempotency_key).toBe('42'.repeat(16));
		expect(facts.locked_ref).toBe(`${'ee'.repeat(32)}:0`);
		expect(facts.provider_musig2_pubkey).toBe(providerPubkey);
		expect(facts.conditional_payload).toHaveLength(128);
	});

	it('rejects the former missing-provider-field fallback path', () => {
		const incomplete = {
			musig2_pubkey: providerPubkey,
			settle_nonce: publicNonce,
			refund_nonce: publicNonce
		} as ProviderMaterial;

		expect(() =>
			buildSwapInitiateFacts({
				order,
				bearer,
				provider: incomplete,
				bearerSeller,
				encSecretForProvider: encryptedSecret(),
				prepared: prepared()
			})
		).toThrow(/provider_fp/);
	});

	it('rejects the old public hash plus provider-key encryption substitute', () => {
		const publicSubstitute = new Uint8Array(64);
		publicSubstitute.set(bearer.publicTokenHash);
		publicSubstitute.set(new Uint8Array(32).fill(0xcc), 32);

		expect(() =>
			buildSwapInitiateFacts({
				order,
				bearer,
				provider: provider(),
				bearerSeller,
				encSecretForProvider: publicSubstitute,
				prepared: prepared()
			})
		).toThrow(/not ciphertext/);
	});

	it('rejects a dummy locked reference and an unframed conditional payload', () => {
		expect(() =>
			buildSwapInitiateFacts({
				order,
				bearer,
				provider: { ...provider(), locked_ref: 'v'.repeat(64) },
				bearerSeller,
				encSecretForProvider: encryptedSecret(),
				prepared: prepared()
			})
		).toThrow(/locked_ref/);

		expect(() =>
			buildSwapInitiateFacts({
				order,
				bearer,
				provider: {
					...provider(),
					conditional_payload: new Uint8Array(128).fill(0xdd)
				},
				bearerSeller,
				encSecretForProvider: encryptedSecret(),
				prepared: prepared()
			})
		).toThrow(/framed ciphertext length/);
	});

	it('rejects a missing or malformed prepare allocation before initiate', () => {
		const base = {
			order,
			bearer,
			provider: provider(),
			bearerSeller,
			encSecretForProvider: encryptedSecret()
		};
		expect(() =>
			buildSwapInitiateFacts({ ...base, prepared: undefined as unknown as PreparedSwapBinding })
		).toThrow(/prepared_swap_id/);
		expect(() =>
			buildSwapInitiateFacts({
				...base,
				prepared: { ...prepared(), requestCommitment: new Uint8Array(31) }
			})
		).toThrow(/prepare_request_commitment/);
		expect(() =>
			buildSwapInitiateFacts({
				...base,
				prepared: { ...prepared(), idempotencyKey: new Uint8Array(16) }
			})
		).toThrow(/idempotency_key.*zero/);
	});
});
