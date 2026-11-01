// H3 parity gate (ADR-0007): extro-node's integer exchange core (Op::Exchange,
// via exchange-core.ts) against (a) the vector extro-node pins in its own Rust
// and JS suites and (b) the legacy TS book-math / publication-fee it replaces.
// The only allowed divergence is the documented integer semantics: a quote-cap
// partial fill floors to whole base units where the float TS fills fractionally.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootArkNode } from '$lib/ark/ark-node.testkit';
import { liveOrders, midPrice, sortAsks, sortBids, spread, walkBook } from './book-math';
import { computePublicationFee } from './publication-fee';
import { bookView, publicationFeeNode, walkBookNode, type ExtroSend } from './exchange-core';
import type { LimitOrder, Seeder, Side } from './types';
import { MOCK_PAIRS } from './mock-data';

const require = createRequire(import.meta.url);

interface VOrder { order_id: string; price_atomic: string; amount_atomic: string; expires_at: string; observed_at: string }
interface Vector {
	now: string;
	bids: VOrder[];
	asks: VOrder[];
	book: { bid_ids: string[]; ask_ids: string[]; spread: string | null; mid_x2: string | null };
	walks: {
		name: string;
		side: 'Buy' | 'Sell';
		requested_amount: string;
		slippage_bps: number | null;
		quote_cap: string | null;
		fills: [string, string, string][];
		filled_amount: string;
		remaining_amount: string;
		total_quote: string;
		stop: string;
	}[];
	fees: {
		name: string;
		order_value: string;
		seeders: [string, string, boolean][];
		total_fee: string;
		shares: [string, string, string][];
		blocked: string | null;
	}[];
}

const v: Vector = JSON.parse(readFileSync(require.resolve('@extro/node/vectors/exchange_core.json'), 'utf8'));
const now = Number(v.now);

const order = (o: { id: string; price: number; amount: number; expiresAt: number; observedAt: number }, side: Side): LimitOrder => ({
	...o,
	pair: MOCK_PAIRS[0],
	side,
	makerFingerprint: 'ab'.repeat(20),
	makerVk: 'cd'.repeat(32),
	source: 'dhtx',
	signedCommitment: ''
});
const fromVector = (o: VOrder, side: Side) =>
	order(
		{ id: o.order_id, price: Number(o.price_atomic), amount: Number(o.amount_atomic), expiresAt: Number(o.expires_at), observedAt: Number(o.observed_at) },
		side
	);
const bids = v.bids.map((o) => fromVector(o, 'buy'));
const asks = v.asks.map((o) => fromVector(o, 'sell'));
const seedersOf = (s: [string, string, boolean][]): Seeder[] =>
	s.map(([fingerprint, rail, active]) => ({ fingerprint, rail: rail as Seeder['rail'], active }));

let send: ExtroSend;
beforeAll(async () => {
	send = (await bootArkNode()).send;
});

describe('Op::Exchange book matches the vector and the legacy TS', () => {
	it('live, sorted book with spread and mid', async () => {
		const b = await bookView(send, bids, asks, now);
		expect(b.bids.map((o) => o.id)).toEqual(v.book.bid_ids);
		expect(b.asks.map((o) => o.id)).toEqual(v.book.ask_ids);
		expect(b.spread).toBe(Number(v.book.spread));
		expect(b.midPrice).toBe(Number(v.book.mid_x2) / 2);

		const tsBids = sortBids(liveOrders(bids, now));
		const tsAsks = sortAsks(liveOrders(asks, now));
		expect(tsBids.map((o) => o.id)).toEqual(v.book.bid_ids);
		expect(tsAsks.map((o) => o.id)).toEqual(v.book.ask_ids);
		expect(spread(tsBids, tsAsks)).toBe(b.spread);
		expect(midPrice(tsBids, tsAsks)).toBe(b.midPrice);
	});
});

describe('Op::Exchange walk matches the vector and the legacy TS', () => {
	for (const w of v.walks) {
		it(w.name, async () => {
			const side: Side = w.side === 'Buy' ? 'buy' : 'sell';
			const params = {
				side,
				requestedAmount: Number(w.requested_amount),
				...(w.slippage_bps === null ? {} : { slippageBps: w.slippage_bps }),
				...(w.quote_cap === null ? {} : { quoteCap: Number(w.quote_cap) })
			};
			const node = await walkBookNode(send, bids, asks, params, now);
			expect(node.fills.map((f) => [f.orderId, String(f.fillAmount), String(f.price)])).toEqual(w.fills);
			expect(node.fills.every((f) => f.side === side && f.makerVk === 'cd'.repeat(32))).toBe(true);
			expect(String(node.filledAmount)).toBe(w.filled_amount);
			expect(String(node.remainingAmount)).toBe(w.remaining_amount);
			expect(String(node.totalQuote)).toBe(w.total_quote);
			expect(node.stop).toBe(w.stop);

			const ts = walkBook(liveOrders(bids, now), liveOrders(asks, now), {
				side,
				requestedAmount: params.requestedAmount,
				slippage: w.slippage_bps === null ? undefined : w.slippage_bps / 10_000,
				quoteCap: params.quoteCap
			});
			expect(ts.stop).toBe(node.stop);
			if (w.stop === 'cap') {
				// Documented divergence: integer core floors the capped partial fill.
				expect(ts.fills.map((f) => [f.orderId, Math.floor(f.fillAmount), f.price])).toEqual(
					node.fills.map((f) => [f.orderId, f.fillAmount, f.price])
				);
				expect(Math.floor(ts.filledAmount)).toBe(node.filledAmount);
			} else {
				expect(ts.fills).toEqual(node.fills);
				expect(ts.filledAmount).toBe(node.filledAmount);
				expect(ts.remainingAmount).toBe(node.remainingAmount);
				expect(ts.totalQuote).toBe(node.totalQuote);
			}
		});
	}

	it('agrees with the legacy TS on random integer books (no cap)', async () => {
		let seed = 0x5eed;
		const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
		for (let t = 0; t < 150; t++) {
			const mk = (side: Side, k: number) =>
				Array.from({ length: rnd(8) }, (_, i) =>
					order(
						{
							id: `${side[0]}${t}-${i}-${k}`,
							price: 1 + rnd(1000),
							amount: rnd(50),
							expiresAt: now - 5 + rnd(20),
							observedAt: rnd(4)
						},
						side
					)
				);
			const b = mk('buy', 0);
			const a = mk('sell', 1);
			const side: Side = rnd(2) ? 'buy' : 'sell';
			const bps = rnd(3) === 0 ? undefined : rnd(600);
			const requestedAmount = rnd(300);
			const node = await walkBookNode(send, b, a, { side, requestedAmount, slippageBps: bps }, now);
			const ts = walkBook(liveOrders(b, now), liveOrders(a, now), {
				side,
				requestedAmount,
				slippage: bps === undefined ? undefined : bps / 10_000
			});
			expect(node, `case ${t}`).toEqual(ts);
			const view = await bookView(send, b, a, now);
			expect(view.bids).toEqual(sortBids(liveOrders(b, now)));
			expect(view.asks).toEqual(sortAsks(liveOrders(a, now)));
		}
	});

	it('refuses non-integer amounts instead of rounding', async () => {
		await expect(walkBookNode(send, bids, asks, { side: 'buy', requestedAmount: 1.5 }, now)).rejects.toThrow(RangeError);
		await expect(walkBookNode(send, bids, asks, { side: 'buy', requestedAmount: 1, slippageBps: 10_001 }, now)).rejects.toThrow();
	});
});

describe('Op::Exchange publication fee matches the vector and the legacy TS', () => {
	for (const f of v.fees) {
		it(f.name, async () => {
			const seeders = seedersOf(f.seeders);
			const node = await publicationFeeNode(send, Number(f.order_value), seeders);
			expect(String(node.totalFee)).toBe(f.total_fee);
			expect(node.shares.map((s) => [s.seederFingerprint, s.rail, String(s.amount)])).toEqual(f.shares);
			expect(node.allowed).toBe(f.blocked === null);
			expect(node.blockedReason).toBe(f.blocked ?? undefined);
			expect(node).toEqual(computePublicationFee(Number(f.order_value), seeders));
		});
	}

	it('agrees with the legacy TS on random inputs', async () => {
		let seed = 7;
		const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
		for (let t = 0; t < 100; t++) {
			const seeders: Seeder[] = Array.from({ length: rnd(6) }, (_, i) => ({
				fingerprint: (i + 1).toString(16).padStart(2, '0').repeat(20),
				rail: rnd(12) === 0 ? ('lightning' as Seeder['rail']) : rnd(2) ? 'webcash' : 'bitcoin_ark',
				active: rnd(4) !== 0
			}));
			const value = rnd(10_000_000);
			expect(await publicationFeeNode(send, value, seeders), `case ${t}`).toEqual(computePublicationFee(value, seeders));
		}
	});
});
