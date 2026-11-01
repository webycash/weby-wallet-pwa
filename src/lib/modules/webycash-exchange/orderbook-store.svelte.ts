// Orderbook reactive store — a THIN wrapper. It holds the observed orders + the
// selected pair as Svelte 5 runes; the live bids/asks/spread/mid and market
// walks come from extro-node's exchange core (`Op::Exchange`, via
// `exchange-core.ts`, ADR-0007 H3). This file contains no book math.
//
// SECRECY: orders here are PUBLIC commitments only (signed-order metadata). No
// plaintext secret is ever stored in this state.

import { bookView, walkBookNode, type BookView, type NodeWalkParams } from './exchange-core';
import { evaluatePair, type AssetClass } from './pair-policy';
import { MARKET_PAIRS, pairKey } from './pairs';
import { recordObservation } from './market-data';
import { getExtroClient } from '$lib/extro';
import { notePeersObserved } from '$lib/extro/connection';
import { newRequestId, type WireAssetRef, type WireOrder } from '@extro/node';
import type { LimitOrder, MarketWalk, Side, TradingPair } from './types';

/** Lowercase hex of bytes. */
const bytesToHex = (b: Uint8Array): string => {
	let s = '';
	for (const x of b) s += x.toString(16).padStart(2, '0');
	return s;
};

/** Standard base64 of bytes (signed-commitment carriage matches `LimitOrder`). */
const bytesToB64 = (b: Uint8Array): string => {
	let bin = '';
	for (const x of b) bin += String.fromCharCode(x);
	return typeof btoa !== 'undefined'
		? btoa(bin)
		: Buffer.from(b).toString('base64');
};

/**
 * Map a wire `WireOrder` (discovered over DHTX) onto the exchange `LimitOrder`
 * the book renders. `source` is always `'dhtx'` — there is no mock/paste path.
 * The `signed_commitment` bytes are carried verbatim (base64) so a downstream
 * fill can re-verify the maker signature.
 */
function toLimitOrder(o: WireOrder): LimitOrder {
	return {
		id: bytesToHex(o.order_id),
		pair: {
			base: o.pair.base as AssetClass,
			quote: o.pair.quote as AssetClass
		},
		assets: { base: o.base, quote: o.quote },
		side: (o.side === 'Buy' ? 'buy' : 'sell') as Side,
		price: Number(o.price_atomic),
		amount: Number(o.amount_atomic),
		makerFingerprint: bytesToHex(o.maker_fp),
		makerVk: bytesToHex(o.maker_vk),
		expiresAt: Number(o.expires_at),
		observedAt: Number(o.observed_at),
		source: 'dhtx',
		signedCommitment: bytesToB64(o.signed_commitment)
	};
}

/**
 * Recv-plane diagnostics surfaced alongside each `FetchOrders` result (the wire
 * `ResponseBody::Orders.diag`). Lets the UI — and the e2e harness — distinguish a
 * never-arrived order (transport / half-open: `total_frames_seen === 0` while
 * `peers_connected ≥ 1`) from a received-but-dropped one (`total_frames_seen > 0`
 * while `orders_recorded === 0`, with a non-zero `drop_*`). All counters are
 * non-secret. `null` until the first refresh.
 */
export interface RecvDiag {
	peers_connected: number;
	channels_open: number;
	frames_drained_this_poll: number;
	total_frames_seen: number;
	orders_recorded: number;
	drop_decode: number;
	drop_bad_signature: number;
	drop_fp_mismatch: number;
	drop_bad_vk: number;
	drop_body_mismatch: number;
	redundant_duplicate: number;
	redundant_expired: number;
	last_drop_peek_byte: number;
	last_drop_frame_len: number;
	last_drop_declared_len: number;
	last_drop_frame_hex: string;
	last_drop_error: string;
}

interface BookState {
	pair: TradingPair;
	orders: LimitOrder[];
	loading: boolean;
	error: string | null;
	/** Unix seconds of the last successful refresh (freshness label). */
	lastUpdated: number | null;
	/** Source channel label for the current book. */
	source: string;
	/** Recv-plane diagnostics from the last refresh; `null` until first poll. */
	diag: RecvDiag | null;
}

const state = $state<BookState>({
	pair: MARKET_PAIRS[0],
	orders: [],
	loading: false,
	error: null,
	lastUpdated: null,
	source: 'dhtx',
	diag: null
});

const nowSec = () => Math.floor(Date.now() / 1000);

const EMPTY_VIEW: BookView = { bids: [], asks: [], spread: null, midPrice: null };

/** Live book for the selected pair, as last computed by extro-node. */
const view = $state<{ current: BookView }>({ current: EMPTY_VIEW });

/** The selected pair's orders, split by maker side (expiry is applied by the node). */
const pairSides = (): { bids: LimitOrder[]; asks: LimitOrder[] } => {
	const mine = state.orders.filter(
		(o) => o.pair.base === state.pair.base && o.pair.quote === state.pair.quote
	);
	return { bids: mine.filter((o) => o.side === 'buy'), asks: mine.filter((o) => o.side === 'sell') };
};

let viewSeq = 0;

/** Recompute the live book view; a stale (superseded) result is discarded. */
async function recomputeView(): Promise<void> {
	const seq = ++viewSeq;
	const { bids, asks } = pairSides();
	try {
		const next = await bookView(getExtroClient().send.bind(getExtroClient()), bids, asks, nowSec());
		if (seq === viewSeq) view.current = next;
	} catch (e) {
		if (seq === viewSeq) {
			view.current = EMPTY_VIEW;
			state.error = String(e);
		}
	}
}

export const orderbook = {
	get pair() {
		return state.pair;
	},
	get pairs() {
		return MARKET_PAIRS;
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
	/** Recv-plane diagnostics from the last refresh (`null` until first poll). */
	get diag(): RecvDiag | null {
		return state.diag;
	},
	get bids(): LimitOrder[] {
		return view.current.bids;
	},
	get asks(): LimitOrder[] {
		return view.current.asks;
	},
	get spread(): number | null {
		return view.current.spread;
	},
	get midPrice(): number | null {
		return view.current.midPrice;
	},
	get isEmpty(): boolean {
		return view.current.bids.length + view.current.asks.length === 0;
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
	void recomputeView();
	void refreshBook();
}

/**
 * Refresh the book for the selected pair by **discovering orders from the node
 * network over DHTX** — no central server, no mock, no out-of-band paste. Issues
 * `DhtxCommand::FetchOrders` through the facade client; the WASM drains any frames
 * that arrived from connected peers, sweeps expired, and returns the verified
 * public-commitment set. Orders enter the store ONLY from the network.
 */
export async function refreshBook(): Promise<void> {
	state.loading = true;
	state.error = null;
	try {
		const client = getExtroClient();
		const resp = await client.send({
			request_id: newRequestId(),
			op: {
				kind: 'Dhtx',
				cmd: { op: 'FetchOrders', pair: { base: state.pair.base, quote: state.pair.quote } }
			}
		});
		if (resp.kind === 'Ok' && resp.body.kind === 'Orders') {
			state.orders = resp.body.orders.map(toLimitOrder);
			state.lastUpdated = nowSec();
			state.source = 'dhtx';
			// The WASM attaches recv-plane counters to every Orders body (additive
			// field; the codec passes it through untyped). Capture it for the UI +
			// the e2e diagnosis. Cast through unknown — commands.ts has not yet
			// declared the field on the Orders body type.
			state.diag = ((resp.body as unknown as { diag?: RecvDiag }).diag ?? null);
			if (state.diag?.peers_connected) notePeersObserved(state.diag.peers_connected);
			await recomputeView();
			// Record a REAL observation of the book (mid + resting depth) into the
			// historic series that backs the candle/volume charts — no mocks.
			const depth = [...orderbook.bids, ...orderbook.asks].reduce((s, o) => s + o.amount, 0);
			recordObservation(state.pair, orderbook.midPrice, depth);
		} else if (resp.kind === 'Err') {
			state.error = resp.message;
		} else {
			state.error = `unexpected response body: ${resp.body.kind}`;
		}
	} catch (e) {
		state.error = String(e);
	} finally {
		state.loading = false;
	}
}

/**
 * The signed order asset for one side of the selected pair. Webcash and
 * BitcoinArk need no namespace; a Voucher/RGB side must be given explicitly
 * (contract + issuer), else this fails closed — the node refuses it too.
 */
export function orderAssetFor(family: AssetClass, given?: WireAssetRef): WireAssetRef {
	if (given) {
		if (given.family !== family) {
			throw new Error(`ORDER_ASSET_MISMATCH: pair side ${family}, asset ${given.family}`);
		}
		return given;
	}
	if (family === 'Webcash' || family === 'BitcoinArk') return { family };
	throw new Error(`ORDER_ASSET_UNNAMESPACED: ${family} needs contract_id + issuer_fp`);
}

/**
 * Publish a signed limit order into the node network. The wallet identity key
 * signs the order INSIDE the WASM (it never crosses the JS boundary), records it
 * locally, and broadcasts an `OrderAnnounce` to every connected peer. Returns the
 * number of peers the announce reached (`0` when no peer is connected). On
 * success the local book is refreshed so the maker sees its own order.
 */
export async function publishOrder(input: {
	slot: number;
	side: Side;
	/** Price in quote-per-base, atomic units. */
	priceAtomic: bigint;
	/** Base amount, atomic units. */
	amountAtomic: bigint;
	/** Unix seconds the order expires (TTL). */
	expiresAt: number;
	/** Namespaced assets for a Voucher/RGB side (see {@link orderAssetFor}). */
	assets?: { base?: WireAssetRef; quote?: WireAssetRef };
}): Promise<{ ok: true; orderId: string; peersBroadcast: number } | { ok: false; error: string }> {
	let base: WireAssetRef, quote: WireAssetRef;
	try {
		base = orderAssetFor(state.pair.base, input.assets?.base);
		quote = orderAssetFor(state.pair.quote, input.assets?.quote);
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	const client = getExtroClient();
	const resp = await client.send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: {
				op: 'PublishOrder',
				slot: input.slot,
				base,
				quote,
				side: input.side === 'buy' ? 'Buy' : 'Sell',
				price_atomic: input.priceAtomic,
				amount_atomic: input.amountAtomic,
				expires_at: input.expiresAt
			}
		}
	});
	if (resp.kind === 'Ok' && resp.body.kind === 'OrderPublished') {
		const orderId = bytesToHex(resp.body.order_id);
		await refreshBook();
		return { ok: true, orderId, peersBroadcast: resp.body.peers_broadcast };
	}
	return {
		ok: false,
		error: resp.kind === 'Err' ? resp.message : `unexpected response: ${resp.body.kind}`
	};
}

/** Walk the current live book for a market order (extro-node `Op::Exchange`). */
export function walkCurrent(params: NodeWalkParams): Promise<MarketWalk> {
	const { bids, asks } = pairSides();
	return walkBookNode(getExtroClient().send.bind(getExtroClient()), bids, asks, params, nowSec());
}
