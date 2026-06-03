// Orderbook reactive store — a THIN wrapper over the pure `book-math` and
// `pair-policy` modules. It holds the observed orders + the selected pair as
// Svelte 5 runes and exposes derived bids/asks/spread. All the actual math is
// unit-tested in `book-math.test.ts`; this file deliberately contains no logic
// worth unit-testing of its own.
//
// SECRECY: orders here are PUBLIC commitments only (signed-order metadata). No
// plaintext secret is ever stored in this state.

import {
	sortAsks,
	sortBids,
	spread as calcSpread,
	midPrice as calcMid,
	liveOrders,
	walkBook,
	type WalkParams
} from './book-math';
import { evaluatePair, type AssetClass } from './pair-policy';
import { mockBook, MOCK_PAIRS, pairKey } from './mock-data';
import type { LimitOrder, MarketWalk, TradingPair } from './types';

interface BookState {
	pair: TradingPair;
	orders: LimitOrder[];
	loading: boolean;
	error: string | null;
	/** Unix seconds of the last successful refresh (freshness label). */
	lastUpdated: number | null;
	/** Source channel label for the current book. */
	source: string;
}

const state = $state<BookState>({
	pair: MOCK_PAIRS[0],
	orders: [],
	loading: false,
	error: null,
	lastUpdated: null,
	source: 'mock'
});

const nowSec = () => Math.floor(Date.now() / 1000);

/** All non-expired orders for the selected pair. */
const live = (): LimitOrder[] =>
	liveOrders(
		state.orders.filter(
			(o) => o.pair.base === state.pair.base && o.pair.quote === state.pair.quote
		),
		nowSec()
	);

export const orderbook = {
	get pair() {
		return state.pair;
	},
	get pairs() {
		return MOCK_PAIRS;
	},
	get loading() {
		return state.loading;
	},
	get error() {
		return state.error;
	},
	get lastUpdated() {
		return state.lastUpdated;
	},
	get source() {
		return state.source;
	},
	get bids(): LimitOrder[] {
		return sortBids(live().filter((o) => o.side === 'buy'));
	},
	get asks(): LimitOrder[] {
		return sortAsks(live().filter((o) => o.side === 'sell'));
	},
	get spread(): number | null {
		const l = live();
		return calcSpread(
			l.filter((o) => o.side === 'buy'),
			l.filter((o) => o.side === 'sell')
		);
	},
	get midPrice(): number | null {
		const l = live();
		return calcMid(
			l.filter((o) => o.side === 'buy'),
			l.filter((o) => o.side === 'sell')
		);
	},
	get isEmpty(): boolean {
		return live().length === 0;
	},
	/** The pair-policy verdict for the selected pair. */
	get verdict() {
		return evaluatePair(state.pair.base, state.pair.quote);
	}
};

export const pairLabel = (p: TradingPair): string => pairKey(p);

export const assetClasses = (p: TradingPair): [AssetClass, AssetClass] => [p.base, p.quote];

export function selectPair(pair: TradingPair): void {
	state.pair = pair;
	void refreshBook();
}

/**
 * Refresh the book for the selected pair. Today this loads MOCK data (real
 * torrent/DHTX subscription is deferred); the loading/error states are real so
 * the UI is exercised.
 */
export async function refreshBook(): Promise<void> {
	state.loading = true;
	state.error = null;
	try {
		// Simulate an async subscription tick.
		await Promise.resolve();
		state.orders = mockBook(state.pair, 100);
		state.lastUpdated = nowSec();
		state.source = 'mock';
	} catch (e) {
		state.error = String(e);
	} finally {
		state.loading = false;
	}
}

/** Walk the current live book for a market order. Pure delegation. */
export function walkCurrent(params: WalkParams): MarketWalk {
	const l = live();
	return walkBook(
		l.filter((o) => o.side === 'buy'),
		l.filter((o) => o.side === 'sell'),
		params
	);
}
