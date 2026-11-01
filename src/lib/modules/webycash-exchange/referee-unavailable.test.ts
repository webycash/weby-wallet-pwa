// A tier without a referee (development only; @extro/node refuses it on
// staging/production) never installs one, so settlement stops at the named
// REFEREE_UNAVAILABLE gate instead of a generic error or a fake terminal phase.
import { describe, it, expect } from 'vitest';
import { openTrade, runSwap, settleTrade } from './trade-store.svelte';
import { GATE_REFEREE_UNAVAILABLE, isNamedArkGateError } from '$lib/ark/named-gates';

describe('referee unavailable', () => {
	it('settle and runSwap stop at GATE_REFEREE_UNAVAILABLE when no referee is installed', async () => {
		const t = openTrade({
			swapId: 'no-referee-1',
			pair: { base: 'BitcoinArk', quote: 'Webcash' },
			side: 'buy',
			amount: 1,
			price: 1,
			settlementModel: 'referee-mediated',
			requiresReferee: true
		});
		const settle = await settleTrade(t.swapId).catch((e) => e);
		expect(isNamedArkGateError(settle)).toBe(true);
		expect(settle.gate).toBe(GATE_REFEREE_UNAVAILABLE);
		const run = await runSwap({} as Parameters<typeof runSwap>[0]).catch((e) => e);
		expect(isNamedArkGateError(run) && run.gate).toBe(GATE_REFEREE_UNAVAILABLE);
	});
});
