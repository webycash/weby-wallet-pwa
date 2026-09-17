import { describe, it, expect } from 'vitest';
import { sortBids, sortAsks, spread, midPrice, walkBook, bestBid, bestAsk } from './book-math';
import type { LimitOrder, TradingPair } from './types';

const PAIR: TradingPair = { base: 'BitcoinArk', quote: 'Webcash' };

let seq = 0;
const order = (
	side: 'buy' | 'sell',
	price: number,
	amount = 100,
	observedAt = ++seq
): LimitOrder => ({
	id: `${side}-${price}-${amount}-${observedAt}`,
	pair: PAIR,
	side,
	price,
	amount,
	makerFingerprint: 'aa'.repeat(20),
	makerVk: 'bb'.repeat(32),
	expiresAt: 9_999_999_999,
	observedAt,
	source: 'mock',
	signedCommitment: ''
});

describe('orderbook sorting', () => {
	it('sorts bids descending by price (best bid first)', () => {
		const bids = [order('buy', 100), order('buy', 105), order('buy', 99)];
		const sorted = sortBids(bids);
		expect(sorted.map((o) => o.price)).toEqual([105, 100, 99]);
		expect(bestBid(bids)?.price).toBe(105);
	});

	it('sorts asks ascending by price (best ask first)', () => {
		const asks = [order('sell', 110), order('sell', 108), order('sell', 120)];
		const sorted = sortAsks(asks);
		expect(sorted.map((o) => o.price)).toEqual([108, 110, 120]);
		expect(bestAsk(asks)?.price).toBe(108);
	});
});

describe('spread', () => {
	it('computes best ask − best bid', () => {
		const bids = [order('buy', 100), order('buy', 98)];
		const asks = [order('sell', 105), order('sell', 110)];
		expect(spread(bids, asks)).toBe(5);
		expect(midPrice(bids, asks)).toBe(102.5);
	});

	it('returns null (not NaN) when a side is empty', () => {
		expect(spread([], [order('sell', 105)])).toBeNull();
		expect(spread([order('buy', 100)], [])).toBeNull();
		expect(spread([], [])).toBeNull();
		expect(midPrice([], [])).toBeNull();
	});

	it('returns a negative spread verbatim for a crossed book', () => {
		const bids = [order('buy', 110)];
		const asks = [order('sell', 100)];
		expect(spread(bids, asks)).toBe(-10);
	});
});

describe('market walk: partial fills across maker orders', () => {
	it('consumes best ask first, then walks to the next (buy)', () => {
		// Alice asks 100 @ price 10, Bob asks 1000 @ price 11. Buy 600.
		const asks = [order('sell', 10, 100), order('sell', 11, 1000)];
		const walk = walkBook([], asks, { side: 'buy', requestedAmount: 600 });
		expect(walk.stop).toBe('filled');
		expect(walk.fills.length).toBe(2);
		expect(walk.fills[0]).toMatchObject({ price: 10, fillAmount: 100 });
		expect(walk.fills[1]).toMatchObject({ price: 11, fillAmount: 500 });
		expect(walk.filledAmount).toBe(600);
		expect(walk.remainingAmount).toBe(0);
		expect(walk.totalQuote).toBe(100 * 10 + 500 * 11);
	});

	it('reports book-exhausted with remaining amount when liquidity runs out', () => {
		const asks = [order('sell', 10, 100)];
		const walk = walkBook([], asks, { side: 'buy', requestedAmount: 1000 });
		expect(walk.stop).toBe('book-exhausted');
		expect(walk.filledAmount).toBe(100);
		expect(walk.remainingAmount).toBe(900);
	});

	it('walks bids descending for a market sell', () => {
		const bids = [order('buy', 12, 50), order('buy', 11, 50), order('buy', 9, 50)];
		const walk = walkBook(bids, [], { side: 'sell', requestedAmount: 80 });
		expect(walk.fills[0].price).toBe(12);
		expect(walk.fills[1].price).toBe(11);
		expect(walk.filledAmount).toBe(80);
	});

	it('handles empty book without crashing', () => {
		const walk = walkBook([], [], { side: 'buy', requestedAmount: 100 });
		expect(walk.stop).toBe('book-exhausted');
		expect(walk.fills).toEqual([]);
		expect(walk.remainingAmount).toBe(100);
	});
});

describe('market walk: slippage guard (separate from cap)', () => {
	it('stops at the first order beyond the slippage bound', () => {
		// Best ask 10. 5% slippage → upper price limit 10.5. Next order @ 11 is
		// out of bounds and must NOT be touched.
		const asks = [order('sell', 10, 100), order('sell', 11, 1000)];
		const walk = walkBook([], asks, {
			side: 'buy',
			requestedAmount: 600,
			slippage: 0.05
		});
		expect(walk.stop).toBe('slippage');
		expect(walk.fills.length).toBe(1);
		expect(walk.filledAmount).toBe(100);
		expect(walk.remainingAmount).toBe(500);
	});

	it('allows orders exactly at the slippage bound', () => {
		// Best bid 10, 10% slippage → lower limit 9. Order @ 9 is acceptable.
		const bids = [order('buy', 10, 50), order('buy', 9, 50)];
		const walk = walkBook(bids, [], {
			side: 'sell',
			requestedAmount: 100,
			slippage: 0.1
		});
		expect(walk.stop).toBe('filled');
		expect(walk.fills.length).toBe(2);
	});
});

describe('market walk: quote cap guard (separate from slippage)', () => {
	it('stops when the quote cap is reached, partial-filling up to the cap', () => {
		// Buy at price 10, cap total quote at 250 → can afford 25 base.
		const asks = [order('sell', 10, 1000)];
		const walk = walkBook([], asks, {
			side: 'buy',
			requestedAmount: 1000,
			quoteCap: 250
		});
		expect(walk.stop).toBe('cap');
		expect(walk.filledAmount).toBeCloseTo(25, 9);
		expect(walk.totalQuote).toBeLessThanOrEqual(250 + 1e-6);
		expect(walk.remainingAmount).toBeGreaterThan(0);
	});

	it('cap and slippage are distinct stops', () => {
		// Slippage would NOT trigger (single price level), so the only possible
		// stop is the cap.
		const asks = [order('sell', 10, 1000)];
		const walk = walkBook([], asks, {
			side: 'buy',
			requestedAmount: 1000,
			slippage: 0.5,
			quoteCap: 100
		});
		expect(walk.stop).toBe('cap');
	});
});
