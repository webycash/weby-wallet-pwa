import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	GATE_ARK_DISABLED,
	GATE_RUNSWAP_STOPPED_NO_PROVIDER
} from '$lib/ark/named-gates';
import { attemptRunSwapBoundary } from './accept-run-swap';
import type { LimitOrder } from './types';

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
	runSwap: vi.fn(async () => null)
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
});

describe('named gates', () => {
	it('exports Ark-disabled gate for UI evidence', () => {
		expect(GATE_ARK_DISABLED).toContain('ark_enabled=false');
	});
});
