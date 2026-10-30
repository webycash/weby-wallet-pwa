/**
 * Protocol-level wiring of the settle ceremony (both roles), with every
 * WASM/network edge mocked. Uses the Rust musig2 cross-impl vector so the
 * seller's aggregation is checked against real BIP327 output.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import vector from '$lib/ark/settle-ceremony.vector.json';

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const ORDER_ID = '0f'.repeat(16);
const SELLER_FP = 'ab'.repeat(20);
const PROVIDER_FP = 'cd'.repeat(20);
const LOCKED = `${'33'.repeat(32)}:0`;
const CFG = {
	ark_enabled: true,
	ark_network: 'signet',
	ark_signer_pk_hex: '44'.repeat(32),
	ark_info_digest_hex: '55'.repeat(32),
	ark_unilateral_exit_delay: 172544,
	ark_asp_url: 'https://asp.invalid',
	referee_url: 'https://referee.invalid',
	referee_vk_hex: '66'.repeat(32)
};
const CAPS = ['ark-prepare-policies-v1', 'hex-sighash-v1', 'settle-ceremony-v1'];

const state = vi.hoisted(() => ({
	refereePubkey: null as unknown,
	msgs: [] as unknown[],
	material: null as unknown,
	walletCreate: vi.fn(),
	balance: '0',
	q: ''
}));

vi.mock('$lib/extro/runtime-config', () => ({ getRuntimeConfig: () => CFG }));
vi.mock('$lib/extro/self-identity', () => ({
	getSelfIdentity: async () => ({ fingerprintHex: PROVIDER_FP, verifyingKey: hex('77'.repeat(32)) })
}));
vi.mock('$lib/ark/ark-view', () => ({
	loadArkOverview: async () => ({ arkAddress: 'tark1provider', offchainSats: state.balance })
}));
vi.mock('$lib/extro', () => ({
	getExtroClient: () => ({
		send: async (req: { op: { cmd: { op: string } } }) => {
			if (req.op.cmd.op === 'SendProviderOffer') return { kind: 'Ok', body: { kind: 'SwapMsgSent', delivered: true } };
			if (req.op.cmd.op === 'InspectSwapPrepare') return { kind: 'Ok', body: { kind: 'SwapPrepareTerms', terms: providerTerms() } };
			throw new Error(`unexpected op ${req.op.cmd.op}`);
		}
	})
}));
vi.mock('./referee-client', () => ({
	HttpRefereeClient: class {
		async pubkey() {
			if (!state.refereePubkey) throw new Error('referee down');
			return state.refereePubkey;
		}
	}
}));
vi.mock('./accept-run-swap', () => ({
	fetchSwapMsgs: async () => ({ provider: state.msgs.length ? state.msgs.shift() : state.material }),
	probeProviderMaterial: async () => ({ ok: true })
}));
vi.mock('./swap-prepare', () => ({
	signSwapPrepare: async () => ({ signed: new Uint8Array([1]), requestCommitment: hex('88'.repeat(32)) }),
	countersignSwapPrepare: async () => ({ signed: new Uint8Array([2]), requestCommitment: hex('88'.repeat(32)) }),
	relaySwapPrepareSignature: async () => true,
	fetchSwapPrepareInbox: async () => ({
		providerSigned: new Uint8Array([2]),
		bearerSellerSigned: new Uint8Array([1]),
		signedResponse: new Uint8Array([3])
	}),
	verifySwapPreparedResponse: async () => prepared()
}));
vi.mock('./accept-prepare', async (orig) => ({
	...(await orig<typeof import('./accept-prepare')>()),
	submitDualSignedPrepare: async () => prepared()
}));
vi.mock('$lib/ark/swap-contract', () => ({
	deriveVerifiedArkContractPlan: async () => ({
		swapId: 'swap-1',
		amountSats: 1000n,
		aggregateOwnerKey: hex(state.q)
	}),
	buildArkSwapContract: (_c: unknown, plan: unknown) => ({ plan, address: 'tark1contract' }),
	fundArkSwapContract: async () => ({ arkTxId: '33'.repeat(32) })
}));
vi.mock('$lib/ark/funded-ref', () => ({
	resolveFundedLockedRef: async () => LOCKED,
	assertFundedLockedRef: async () => undefined
}));
vi.mock('$lib/ark/provider-material', () => ({
	fundingRefsFromTemplates: async (_p: unknown, lockedRef: string) => ({
		lockedRef,
		txSettleHashHex: vector.sighash_hex,
		txRefundHashHex: 'a5'.repeat(32)
	})
}));
vi.mock('@arkade-os/sdk', () => ({
	Wallet: { create: state.walletCreate },
	RestIndexerProvider: class {}
}));

import { runSwapRole, type SwapProgress } from './ark-swap-protocol';

function prepared() {
	return {
		swapId: 'swap-1',
		requestCommitment: hex('88'.repeat(32)),
		idempotencyKey: hex('99'.repeat(16)),
		expiresAtUnix: 0,
		signedResponse: new Uint8Array([3]),
		refereeMusig2Pubshare: vector.referee_pubkey_hex,
		refereeSettleNoncePub: vector.referee_nonce_hex,
		refereeRefundNoncePub: vector.referee_nonce_hex
	};
}

const offer = () => ({
	order_id: hex(ORDER_ID),
	provider_fp: hex(PROVIDER_FP),
	provider_pgp_pubkey: hex('77'.repeat(32)),
	provider_musig2_pubkey: vector.provider_pubkey_hex,
	settle_nonce_pub: vector.provider_nonce_hex,
	refund_nonce_pub: vector.provider_nonce_hex,
	provider_cancel_pubkey_hex: '77'.repeat(32),
	locked_ref: 'offer:tark1provider',
	tx_settle_hash_hex: '',
	tx_refund_hash_hex: ''
});
const fundedMaterial = () => ({ ...offer(), locked_ref: LOCKED, tx_settle_hash_hex: vector.sighash_hex, tx_refund_hash_hex: 'a5'.repeat(32) });

function providerTerms() {
	const id32 = new Uint8Array(32);
	id32.set(hex(ORDER_ID), 16);
	return {
		order_id: id32,
		signed_order_commitment_sha256: hex('01'.repeat(32)),
		fill_amount_raw: 1n,
		parties: {
			provider_fp: PROVIDER_FP,
			provider_pgp_pubkey_hex: '77'.repeat(32),
			bearer_seller_fp: SELLER_FP,
			bearer_seller_pgp_pubkey_hex: '78'.repeat(32),
			provider_musig2_pubkey: vector.provider_pubkey_hex,
			provider_cancel_pubkey_hex: '77'.repeat(32),
			bearer_seller_cancel_pubkey_hex: '78'.repeat(32)
		},
		provider_nonces: { settle_nonce_pub: vector.provider_nonce_hex, refund_nonce_pub: vector.provider_nonce_hex },
		ark_network: CFG.ark_network,
		ark_operator_signer_pk: hex(CFG.ark_signer_pk_hex),
		ark_operator_info_digest: hex(CFG.ark_info_digest_hex),
		ark_unilateral_exit_delay: BigInt(CFG.ark_unilateral_exit_delay),
		ark_amount_sats: 1000n,
		provider_ark_destination: 'tark1provider',
		bearer_seller_ark_destination: 'tark1seller',
		idempotency_key: hex('99'.repeat(16)),
		nonce: hex('02'.repeat(32)),
		expires_at_unix: Math.floor(Date.now() / 1000) + 600
	};
}

const order = {
	id: ORDER_ID,
	pair: { base: 'Webcash', quote: 'BitcoinArk' },
	side: 'buy',
	price: 10,
	amount: 100,
	makerFingerprint: PROVIDER_FP,
	makerVk: '77'.repeat(32),
	expiresAt: Math.floor(Date.now() / 1000) + 3600,
	observedAt: 0,
	source: 'mock',
	signedCommitment: ''
} as never;

const fast = { stepTimeoutMs: 200, fundingWaitMs: 200, intervalMs: 5 };
const phases = (log: SwapProgress[]) => log.map((p) => p.phase);

beforeEach(() => {
	state.refereePubkey = { ed25519_pubkey_hex: CFG.referee_vk_hex, musig2_pubshare_hex: vector.referee_pubkey_hex, capabilities: CAPS };
	state.msgs = [];
	state.material = null;
	state.walletCreate.mockReset();
	state.balance = '0';
	state.q = vector.owner_q_xonly_hex;
});

describe('provider side', () => {
	it('stops BEFORE funding when the referee is the current (capability-less) build', async () => {
		state.refereePubkey = { ed25519_pubkey_hex: CFG.referee_vk_hex, musig2_pubshare_hex: vector.referee_pubkey_hex, referee_version: 'old' };
		state.balance = '1000000';
		state.material = offer();
		const log: SwapProgress[] = [];
		const out = await runSwapRole('provider', order, SELLER_FP, { ...fast, onProgress: (p) => log.push(p) });
		expect(out.phase).toBe('gate');
		expect(out.gate).toMatch(/^ARK_REFEREE_CEREMONY_UNAVAILABLE/);
		expect(out.contractAddress).toBe('tark1contract');
		expect(phases(log)).not.toContain('funding');
		expect(state.walletCreate).not.toHaveBeenCalled();
	});

	it('stops before funding when KeyAgg(referee, provider) is not the contract key', async () => {
		state.balance = '1000000';
		state.material = offer();
		state.q = '11'.repeat(32);
		const out = await runSwapRole('provider', order, SELLER_FP, fast);
		expect(out.gate).toMatch(/^ARK_SETTLE_CEREMONY_INVALID.*owner key/);
		expect(state.walletCreate).not.toHaveBeenCalled();
	});

	it('funds, binds material to Q, and — with no delivery channel — stops at RELEASE_PENDING without signing', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const sign = vi.fn(async () => vector.provider_partial_hex);
		const log: SwapProgress[] = [];
		const out = await runSwapRole('provider', order, SELLER_FP, { ...fast, providerPartialSigner: sign, onProgress: (p) => log.push(p) });
		expect(out.gate).toMatch(/^ARK_SETTLE_RELEASE_PENDING/);
		expect(phases(log)).toEqual(expect.arrayContaining(['ceremony-ready', 'funding', 'funded', 'material-sent']));
		expect(sign).not.toHaveBeenCalled();
	});

	it('signs in-WASM, self-verifies and delivers when a transport is wired', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const sign = vi.fn(async () => vector.provider_partial_hex);
		const deliverProviderPartial = vi.fn(async () => undefined);
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			providerPartialSigner: sign,
			settleTransport: { deliverProviderPartial }
		});
		expect(out.phase).toBe('settle-partial-delivered');
		expect(deliverProviderPartial).toHaveBeenCalledWith({ swapId: 'swap-1', lockedRef: LOCKED, partialHex: vector.provider_partial_hex });
	});

	it('refuses to deliver a WASM partial that does not verify', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const deliverProviderPartial = vi.fn(async () => undefined);
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			providerPartialSigner: async () => vector.referee_partial_hex,
			settleTransport: { deliverProviderPartial }
		});
		expect(out.gate).toMatch(/^ARK_SETTLE_CEREMONY_INVALID/);
		expect(deliverProviderPartial).not.toHaveBeenCalled();
	});
});

describe('bearer-seller side', () => {
	it('stops at REFEREE_CEREMONY_UNAVAILABLE before waiting for funding on the old referee', async () => {
		state.refereePubkey = { ed25519_pubkey_hex: CFG.referee_vk_hex, musig2_pubshare_hex: vector.referee_pubkey_hex };
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const log: SwapProgress[] = [];
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, { ...fast, onProgress: (p) => log.push(p) });
		expect(out.gate).toMatch(/^ARK_REFEREE_CEREMONY_UNAVAILABLE/);
		expect(phases(log)).not.toContain('awaiting-material');
	});

	it('without a ReleaseSettle transport stops at RELEASE_PENDING after binding', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, fast);
		expect(out.gate).toMatch(/^ARK_SETTLE_RELEASE_PENDING/);
	});

	it('aggregates the exact Rust-vector signature from ReleaseSettle + provider partial', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, {
			...fast,
			settleTransport: {
				awaitReleaseSettle: async () => ({
					release: { refereePartialHex: vector.referee_partial_hex, providerEncPartialB64: 'AAEC', aspVtxoRef: LOCKED },
					providerPartialHex: vector.provider_partial_hex
				})
			}
		});
		expect(out.phase).toBe('settle-aggregated');
		expect(out.settleSignatureHex).toBe(vector.signature_hex);
	});

	it('rejects a tampered referee partial', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, {
			...fast,
			settleTransport: {
				awaitReleaseSettle: async () => ({
					release: { refereePartialHex: vector.provider_partial_hex, providerEncPartialB64: 'AAEC', aspVtxoRef: LOCKED },
					providerPartialHex: vector.provider_partial_hex
				})
			}
		});
		expect(out.gate).toMatch(/^ARK_SETTLE_CEREMONY_INVALID/);
		expect(out.settleSignatureHex).toBeUndefined();
	});
});
