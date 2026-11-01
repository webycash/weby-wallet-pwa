// Order-book math and the seeder publication fee, computed by extro-node's
// integer exchange core (`Op::Exchange`, ADR-0007 H3). This module only maps
// the wallet's `LimitOrder` / `Seeder` shapes onto the wire and back; the math
// lives in extro-node and nowhere else.
//
// Integer semantics (deliberate, pinned by `@extro/node/vectors/exchange_core.json`):
//   * amounts, prices and timestamps are non-negative safe integers (atomic
//     units / unix seconds); anything else is refused, never rounded here;
//   * slippage is integer basis points (0..=10000);
//   * a quote-cap partial fill floors to whole base atomic units;
//   * the mid price is `mid_x2 / 2` (exact for safe integers).

import {
	newRequestId,
	type ExchangeAssetFamily,
	type ExchangeCommand,
	type ExchangeSettlementModel,
	type ExtroCommand,
	type ExtroResponse,
	type WireBookOrder,
	type WireSeeder
} from '@extro/node';
import type { FeeShare, FillRequest, LimitOrder, MarketWalk, PublicationFee, Seeder, Side } from './types';

/** The facade's `send` (an `ExtroClient.send`, or a test node). */
export type ExtroSend = (command: ExtroCommand) => Promise<ExtroResponse>;

type Body<K extends string> = Extract<Extract<ExtroResponse, { kind: 'Ok' }>['body'], { kind: K }>;

async function exchange<K extends string>(send: ExtroSend, cmd: ExchangeCommand, kind: K): Promise<Body<K>> {
	const r = await send({ request_id: newRequestId(), op: { kind: 'Exchange', cmd } });
	if (r.kind === 'Err') throw new Error(`Op::Exchange ${cmd.op}: ${r.message}`);
	if (r.body.kind !== kind) throw new Error(`Op::Exchange ${cmd.op}: unexpected ${r.body.kind}`);
	return r.body as Body<K>;
}

const atomic = (n: number, what: string): bigint => {
	if (!Number.isSafeInteger(n) || n < 0) {
		throw new RangeError(`${what} must be a non-negative integer, got ${n}`);
	}
	return BigInt(n);
};

const num = (b: bigint, what: string): number => {
	if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < -BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`${what} exceeds the safe-integer range`);
	}
	return Number(b);
};

const hexBytes = (hex: string, len: number, what: string): Uint8Array => {
	if (!new RegExp(`^[0-9a-fA-F]{${len * 2}}$`).test(hex)) {
		throw new RangeError(`${what} must be ${len} bytes of hex`);
	}
	return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
};

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// On the wire an order id is its index in the caller's list, so every reply
// maps back onto the caller's own `LimitOrder` exactly (ids are never trusted
// to be unique or well-formed here).
const indexId = (i: number): Uint8Array => {
	const id = new Uint8Array(16);
	new DataView(id.buffer).setUint32(12, i);
	return id;
};
const idIndex = (id: Uint8Array): number => new DataView(id.buffer, id.byteOffset, 16).getUint32(12);

const wireOrders = (orders: readonly LimitOrder[]): WireBookOrder[] =>
	orders.map((o, i) => ({
		order_id: indexId(i),
		price_atomic: atomic(o.price, 'order price'),
		amount_atomic: atomic(o.amount, 'order amount'),
		expires_at: atomic(o.expiresAt, 'order expiresAt'),
		observed_at: atomic(o.observedAt, 'order observedAt')
	}));

const pick = (orders: readonly LimitOrder[], id: Uint8Array): LimitOrder => {
	const o = orders[idIndex(id)];
	if (!o) throw new Error('Op::Exchange returned an unknown order');
	return o;
};

export interface BookView {
	/** Live bids, best (highest) first; equal prices newest first. */
	bids: LimitOrder[];
	/** Live asks, best (lowest) first; equal prices newest first. */
	asks: LimitOrder[];
	/** best ask − best bid (negative on a crossed book); `null` if a side is empty. */
	spread: number | null;
	/** (best bid + best ask) / 2; `null` if a side is empty. */
	midPrice: number | null;
}

/** The live book at `nowSec`: expired and empty orders dropped, sorted, summarised. */
export async function bookView(
	send: ExtroSend,
	bids: readonly LimitOrder[],
	asks: readonly LimitOrder[],
	nowSec: number
): Promise<BookView> {
	const b = await exchange(
		send,
		{ op: 'Book', bids: wireOrders(bids), asks: wireOrders(asks), now: atomic(nowSec, 'now') },
		'ExchangeBook'
	);
	return {
		bids: b.bid_ids.map((id) => pick(bids, id)),
		asks: b.ask_ids.map((id) => pick(asks, id)),
		spread: b.spread === null ? null : num(b.spread, 'spread'),
		midPrice: b.mid_x2 === null ? null : num(b.mid_x2, 'mid') / 2
	};
}

export interface NodeWalkParams {
	/** Taker side: `buy` walks asks, `sell` walks bids. */
	side: Side;
	/** Base atomic units to fill. */
	requestedAmount: number;
	/** Integer basis points from the best price; omitted = unbounded. */
	slippageBps?: number;
	/** Max quote atomic units to spend; omitted = uncapped. */
	quoteCap?: number;
}

/** Walk the live book at `nowSec` for a market order. */
export async function walkBookNode(
	send: ExtroSend,
	bids: readonly LimitOrder[],
	asks: readonly LimitOrder[],
	p: NodeWalkParams,
	nowSec: number
): Promise<MarketWalk> {
	const w = await exchange(
		send,
		{
			op: 'WalkBook',
			bids: wireOrders(bids),
			asks: wireOrders(asks),
			now: atomic(nowSec, 'now'),
			side: p.side === 'buy' ? 'Buy' : 'Sell',
			requested_amount: atomic(p.requestedAmount, 'requested amount'),
			...(p.slippageBps === undefined ? {} : { slippage_bps: p.slippageBps }),
			...(p.quoteCap === undefined ? {} : { quote_cap: atomic(p.quoteCap, 'quote cap') })
		},
		'ExchangeWalk'
	);
	const levels = p.side === 'buy' ? asks : bids;
	const fills: FillRequest[] = w.fills.map((f) => {
		const o = pick(levels, f.order_id);
		return {
			orderId: o.id,
			makerFingerprint: o.makerFingerprint,
			makerVk: o.makerVk,
			pair: o.pair,
			side: p.side,
			fillAmount: num(f.fill_amount, 'fill amount'),
			price: num(f.price_atomic, 'fill price')
		};
	});
	return {
		fills,
		filledAmount: num(w.filled_amount, 'filled amount'),
		remainingAmount: num(w.remaining_amount, 'remaining amount'),
		totalQuote: num(w.total_quote, 'total quote'),
		stop: w.stop
	};
}

/** The 0.1% publication fee for `orderValue`, split equally among active seeders. */
export async function publicationFeeNode(
	send: ExtroSend,
	orderValue: number,
	seeders: readonly Seeder[]
): Promise<PublicationFee> {
	const wire: WireSeeder[] = seeders.map((s) => ({
		fingerprint: hexBytes(s.fingerprint, 20, 'seeder fingerprint'),
		rail: s.rail,
		active: s.active
	}));
	const f = await exchange(
		send,
		{ op: 'PublicationFee', order_value: atomic(orderValue, 'order value'), seeders: wire },
		'ExchangePublicationFee'
	);
	const shares: FeeShare[] = f.shares.map((s) => ({
		seederFingerprint: toHex(s.fingerprint),
		rail: s.rail as FeeShare['rail'],
		amount: num(s.amount, 'fee share'),
		receiptId: ''
	}));
	const totalFee = num(f.total_fee, 'total fee');
	return f.blocked === null
		? { allowed: true, totalFee, shares }
		: { allowed: false, totalFee, shares, blockedReason: f.blocked };
}

/**
 * extrolib `PairPolicy` for an ordered pair, from `Op::Exchange PairPolicy`
 * (default-deny; ARK<->ARK and unknown pairs are Forbidden).
 */
export async function pairPolicyNode(
	send: ExtroSend,
	base: ExchangeAssetFamily,
	quote: ExchangeAssetFamily,
	preferConditional = false
): Promise<{ allowed: boolean; settlement_model: ExchangeSettlementModel; requires_referee: boolean; requires_conditional_leg: boolean }> {
	const r = await exchange(send, { op: 'PairPolicy', base, quote, prefer_conditional: preferConditional }, 'ExchangePairPolicy');
	return {
		allowed: r.allowed,
		settlement_model: r.settlement_model,
		requires_referee: r.requires_referee,
		requires_conditional_leg: r.requires_conditional_leg
	};
}
