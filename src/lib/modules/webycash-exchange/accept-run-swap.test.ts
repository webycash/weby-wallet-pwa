import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	GATE_ARK_DISABLED,
	GATE_RUNSWAP_NEED_PREPARE,
	GATE_RUNSWAP_STOPPED_NO_PROVIDER
} from '$lib/ark/named-gates';
import { attemptRunSwapBoundary, providerMaterialFromWire } from './accept-run-swap';
import type { LimitOrder } from './types';
import type { WireProviderMaterial } from '$lib/extro/commands';

vi.mock('$lib/extro', () => ({
	getExtroClient: () => ({
		send: vi.fn()
	})
}));

vi.mock('$lib/extro/runtime-config', () => ({
	getRuntimeConfig: () => ({ ark_enabled: false })
}));

vi.mock('./trade-store.svelte', () => ({
	openTrade: vi.fn((input) => ({
		swapId: input.swapId,
		pair: input.pair,
		side: input.side,
		amount: input.amount,
		price: input.price,
		settlementModel: input.settlementModel,
		requiresReferee: input.requiresReferee,
		phase: 'order-selected',
		timeline: [],
		createdAt: 1,
		updatedAt: 1
	})),
	runSwap: vi.fn(async () => null),
	trades: {
		get swapProgress() {
			return { stage: 'failed', error: 'mock runSwap returned null' };
		}
	}
}));

const sampleOrder = (): LimitOrder => ({
	id: 'ab'.repeat(16),
	pair: { base: 'BitcoinArk', quote: 'Webcash' },
	side: 'sell',
	price: 10,
	amount: 2,
	makerFingerprint: 'cd'.repeat(20),
	makerVk: 'ef'.repeat(32),
	expiresAt: 9_999_999_999,
	observedAt: 1,
	source: 'dhtx',
	signedCommitment: 'YQ=='
});

const sampleWire = (): WireProviderMaterial => ({
	order_id: new Uint8Array(16).fill(1),
	provider_fp: new Uint8Array(20).fill(2),
	provider_pgp_pubkey: new Uint8Array(32).fill(3),
	provider_musig2_pubkey: '02' + 'aa'.repeat(32),
	settle_nonce_pub: '03' + 'bb'.repeat(65),
	refund_nonce_pub: '02' + 'cc'.repeat(65),
	provider_cancel_pubkey_hex: 'dd'.repeat(32),
	locked_ref: `${'ee'.repeat(32)}:0`,
	tx_settle_hash_hex: '11'.repeat(32),
	tx_refund_hash_hex: '22'.repeat(32)
});

describe('attemptRunSwapBoundary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('marks reachedRunSwap and stops at named gate without ProviderMaterial', async () => {
		const progress = await attemptRunSwapBoundary(undefined, sampleOrder().id);
		expect(progress.reachedRunSwap).toBe(true);
		expect(progress.stage).toBe('stopped');
		expect(progress.gate).toBe(GATE_RUNSWAP_STOPPED_NO_PROVIDER);
	});

	it('stops at NEED_PREPARE when DHTX ProviderMaterial is present without RunSwapInput', async () => {
		const progress = await attemptRunSwapBoundary(undefined, sampleOrder().id, undefined, sampleWire());
		expect(progress.reachedRunSwap).toBe(true);
		expect(progress.gate).toBe(GATE_RUNSWAP_NEED_PREPARE);
		expect(progress.provider?.locked_ref).toBe(`${'ee'.repeat(32)}:0`);
	});

	it('buildRunSwapInput path does not stop at NEED_PREPARE once RunSwapInput is supplied', async () => {
		const progress = await attemptRunSwapBoundary(
			{ order: sampleOrder() } as never,
			sampleOrder().id,
			undefined,
			sampleWire()
		);
		expect(progress.reachedRunSwap).toBe(true);
		expect(String(progress.gate || '')).not.toContain('RUNSWAP_NEED_PREPARE');
	});

});

describe('providerMaterialFromWire', () => {
	it('maps wire ProviderMaterial into runSwap shape', () => {
		const payload = new Uint8Array(128);
		payload[0] = 0x00;
		payload[1] = 0x00;
		payload[2] = 0x00;
		payload[3] = 0x20;
		payload[4] = 0xab;
		const m = providerMaterialFromWire(sampleWire(), payload);
		expect(m.locked_ref).toBe(`${'ee'.repeat(32)}:0`);
		expect(m.tx_settle_hash_hex).toBe('11'.repeat(32));
		expect(m.conditional_payload).toHaveLength(128);
	});

	it('rejects placeholder settle hash', () => {
		const wire = sampleWire();
		wire.tx_settle_hash_hex = 'ab'.repeat(32);
		expect(() => providerMaterialFromWire(wire, new Uint8Array(128).fill(1))).toThrow(/placeholder/i);
	});
});

describe('named gates', () => {
	it('exports Ark-disabled gate for UI evidence', () => {
		expect(GATE_ARK_DISABLED).toContain('ark_enabled=false');
	});
});
