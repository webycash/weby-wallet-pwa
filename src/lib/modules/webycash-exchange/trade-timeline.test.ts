import { describe, it, expect } from 'vitest';
import {
	newTrade,
	applyPhase,
	driveToTerminal,
	cancelTrade,
	isTerminal,
	phaseFromReferee
} from './trade-timeline';
import { MockRefereeClient } from './mock-referee-client';
import type { TradingPair } from './types';

const PAIR: TradingPair = { base: 'BitcoinArk', quote: 'Webcash' };

const base = (swapId = '11'.repeat(16)) =>
	newTrade({
		swapId,
		pair: PAIR,
		side: 'buy',
		amount: 100,
		price: 10,
		settlementModel: 'referee-mediated',
		requiresReferee: true,
		now: () => 1000
	});

describe('trade timeline: construction + transitions', () => {
	it('starts in order-selected with one timeline event', () => {
		const t = base();
		expect(t.phase).toBe('order-selected');
		expect(t.timeline.length).toBe(1);
		expect(isTerminal(t)).toBe(false);
	});

	it('appends events and updates phase immutably', () => {
		const t0 = base();
		const t1 = applyPhase(t0, 'request-sent', 1001);
		expect(t0.phase).toBe('order-selected'); // original unchanged
		expect(t1.phase).toBe('request-sent');
		expect(t1.timeline.length).toBe(2);
	});

	it('is a no-op once terminal', () => {
		const settled = applyPhase(base(), 'settled', 1002);
		const after = applyPhase(settled, 'refunded', 1003);
		expect(after.phase).toBe('settled');
		expect(after.timeline.length).toBe(settled.timeline.length);
	});

	it('maps referee phase strings, including completed → settled', () => {
		expect(phaseFromReferee('completed')).toBe('settled');
		expect(phaseFromReferee('refunded')).toBe('refunded');
		expect(phaseFromReferee('fail-to-deliver')).toBe('failed');
		expect(phaseFromReferee('proof-precheck')).toBe('proof-precheck');
	});
});

describe('trade timeline: reaches mocked terminal states', () => {
	it('drives to SETTLED through the happy path', async () => {
		const swapId = 'aa'.repeat(16);
		const referee = new MockRefereeClient(
			{
				[swapId]: [
					'maker-response',
					'proof-precheck',
					'delivery-dispatched',
					'post-check',
					'ark-release',
					'settled'
				]
			},
			() => 2000
		);
		const final = await driveToTerminal(base(swapId), referee, { now: () => 2000 });
		expect(final.phase).toBe('settled');
		expect(isTerminal(final)).toBe(true);
		// Timeline includes the mediated phases.
		expect(final.timeline.map((e) => e.phase)).toContain('proof-precheck');
		expect(final.timeline.map((e) => e.phase)).toContain('ark-release');
	});

	it('drives to REFUNDED', async () => {
		const swapId = 'bb'.repeat(16);
		const referee = new MockRefereeClient(
			{ [swapId]: ['maker-response', 'proof-precheck', 'refunded'] },
			() => 2000
		);
		const final = await driveToTerminal(base(swapId), referee, { now: () => 2000 });
		expect(final.phase).toBe('refunded');
		expect(isTerminal(final)).toBe(true);
	});

	it('drives to FAILED (fail-to-deliver)', async () => {
		const swapId = 'cc'.repeat(16);
		const referee = new MockRefereeClient(
			{ [swapId]: ['maker-response', 'failed'] },
			() => 2000
		);
		const final = await driveToTerminal(base(swapId), referee, { now: () => 2000 });
		expect(final.phase).toBe('failed');
	});

	it('respects maxSteps and does not loop forever on a non-terminating script', async () => {
		const swapId = 'dd'.repeat(16);
		// Script never terminates (stays at maker-response).
		const referee = new MockRefereeClient({ [swapId]: ['maker-response'] }, () => 2000);
		const final = await driveToTerminal(base(swapId), referee, { maxSteps: 3, now: () => 2000 });
		expect(isTerminal(final)).toBe(false);
		expect(final.phase).toBe('maker-response');
	});
});

describe('trade timeline: taker cancel', () => {
	it('cancels a pre-settlement trade', () => {
		const canceled = cancelTrade(base(), 1500);
		expect(canceled.phase).toBe('canceled');
		expect(isTerminal(canceled)).toBe(true);
	});
});

describe('trade timeline: no secrets in notes', () => {
	it('timeline notes are redaction-safe', async () => {
		const swapId = 'ee'.repeat(16);
		const referee = new MockRefereeClient({ [swapId]: ['maker-response', 'settled'] }, () => 2000);
		const final = await driveToTerminal(base(swapId), referee, { now: () => 2000 });
		const json = JSON.stringify(final.timeline).toLowerCase();
		for (const forbidden of ['secret', 'plaintext', 'mnemonic', 'privatekey']) {
			expect(json).not.toContain(forbidden);
		}
	});
});
