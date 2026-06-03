// Pure orderbook math: sorting, spread, and market-order book walking.
//
// All functions are side-effect free and unit-tested. The reactive store
// (`orderbook-store.svelte.ts`) is a thin wrapper that holds the observed
// orders and calls these.

import type { FillRequest, LimitOrder, MarketWalk, Side, WalkStop } from './types';

/** Drop expired orders relative to `nowSec`. */
export const liveOrders = (orders: readonly LimitOrder[], nowSec: number): LimitOrder[] =>
	orders.filter((o) => o.expiresAt > nowSec && o.amount > 0);

/**
 * Bids (buy orders), sorted by price DESCENDING — best (highest) bid first.
 * Ties broken by freshness (most recently observed first) for stable display.
 */
export const sortBids = (bids: readonly LimitOrder[]): LimitOrder[] =>
	[...bids].sort((a, b) => b.price - a.price || b.observedAt - a.observedAt);

/**
 * Asks (sell orders), sorted by price ASCENDING — best (lowest) ask first.
 * Ties broken by freshness.
 */
export const sortAsks = (asks: readonly LimitOrder[]): LimitOrder[] =>
	[...asks].sort((a, b) => a.price - b.price || b.observedAt - a.observedAt);

export const bestBid = (bids: readonly LimitOrder[]): LimitOrder | null =>
	sortBids(bids)[0] ?? null;

export const bestAsk = (asks: readonly LimitOrder[]): LimitOrder | null =>
	sortAsks(asks)[0] ?? null;

/**
 * Local spread = best ask price − best bid price. Returns `null` when either
 * side is empty (never NaN). A negative spread (crossed book) is returned
 * verbatim so the UI can flag it.
 */
export function spread(bids: readonly LimitOrder[], asks: readonly LimitOrder[]): number | null {
	const bb = bestBid(bids);
	const ba = bestAsk(asks);
	if (!bb || !ba) return null;
	return ba.price - bb.price;
}

/** Mid price = (best bid + best ask) / 2, or `null` when a side is empty. */
export function midPrice(
	bids: readonly LimitOrder[],
	asks: readonly LimitOrder[]
): number | null {
	const bb = bestBid(bids);
	const ba = bestAsk(asks);
	if (!bb || !ba) return null;
	return (bb.price + ba.price) / 2;
}

export interface WalkParams {
	side: Side;
	/** Total base amount the taker wants to fill (atomic units). */
	requestedAmount: number;
	/**
	 * Max acceptable price deviation from the BEST price, as a fraction
	 * (e.g. 0.02 = 2%). A fill whose price is worse than
	 * best * (1 ± slippage) stops the walk. `undefined` = no slippage bound.
	 */
	slippage?: number;
	/**
	 * Hard cap on total quote spent (buy) / minimum quote received is not capped.
	 * Adding a fill that would push total quote over `quoteCap` stops the walk.
	 * `undefined` = no cap.
	 */
	quoteCap?: number;
}

/**
 * Walk the locally observed book for a market order, consuming best price
 * first and supporting partial fills across multiple maker orders.
 *
 * Buy  → walks ASKS ascending (cheapest first), bounded by an UPPER price.
 * Sell → walks BIDS descending (highest first), bounded by a LOWER price.
 *
 * Two independent stop guards, reported separately:
 *   - `slippage`: the NEXT order's price is worse than the slippage bound.
 *   - `cap`: adding the next (even partial) fill would breach `quoteCap`.
 *
 * The cap may still produce a partial fill of the current order up to the cap.
 */
export function walkBook(
	bids: readonly LimitOrder[],
	asks: readonly LimitOrder[],
	params: WalkParams
): MarketWalk {
	const { side, requestedAmount } = params;
	const levels = side === 'buy' ? sortAsks(asks) : sortBids(bids);

	const fills: FillRequest[] = [];
	let filledAmount = 0;
	let totalQuote = 0;
	let stop: WalkStop = 'book-exhausted';

	if (levels.length === 0 || requestedAmount <= 0) {
		return {
			fills,
			filledAmount,
			remainingAmount: requestedAmount,
			totalQuote,
			stop: requestedAmount <= 0 ? 'filled' : 'book-exhausted'
		};
	}

	const bestPrice = levels[0].price;
	// Worst acceptable price under the slippage bound.
	const priceLimit =
		params.slippage === undefined
			? undefined
			: side === 'buy'
				? bestPrice * (1 + params.slippage)
				: bestPrice * (1 - params.slippage);

	const withinSlippage = (price: number): boolean => {
		if (priceLimit === undefined) return true;
		return side === 'buy' ? price <= priceLimit + 1e-9 : price >= priceLimit - 1e-9;
	};

	for (const order of levels) {
		const need = requestedAmount - filledAmount;
		if (need <= 0) {
			stop = 'filled';
			break;
		}

		// Slippage guard FIRST: if this order's price is out of bounds, stop here
		// without partially filling it (we won't trade at a worse-than-allowed
		// price). Reported distinctly from the cap stop.
		if (!withinSlippage(order.price)) {
			stop = 'slippage';
			break;
		}

		// Cap guard: how much base can we still afford under the quote cap?
		let take = Math.min(order.amount, need);
		if (params.quoteCap !== undefined) {
			const remainingQuote = params.quoteCap - totalQuote;
			if (remainingQuote <= 0) {
				stop = 'cap';
				break;
			}
			const affordable = order.price > 0 ? remainingQuote / order.price : take;
			if (affordable < take) {
				take = affordable;
				// Partial fill up to the cap, then stop.
				if (take > 0) {
					fills.push(mkFill(order, side, take));
					filledAmount += take;
					totalQuote += take * order.price;
				}
				stop = 'cap';
				break;
			}
		}

		if (take <= 0) {
			stop = 'book-exhausted';
			break;
		}

		fills.push(mkFill(order, side, take));
		filledAmount += take;
		totalQuote += take * order.price;

		if (filledAmount >= requestedAmount - 1e-9) {
			stop = 'filled';
			break;
		}
	}

	return {
		fills,
		filledAmount,
		remainingAmount: Math.max(0, requestedAmount - filledAmount),
		totalQuote,
		stop
	};
}

const mkFill = (order: LimitOrder, side: Side, fillAmount: number): FillRequest => ({
	orderId: order.id,
	makerFingerprint: order.makerFingerprint,
	makerVk: order.makerVk,
	pair: order.pair,
	side,
	fillAmount,
	price: order.price
});
