// Webycash exchange module domain types.
//
// These are APPLICATION types for the orderbook/DEX module. They are NOT the
// generic Extro wire types (those live in extrolib and are spoken through the
// extro facade as signed rkyv bytes). The module holds public commitments and
// metadata only — never a plaintext bearer secret.

import type { AssetClass, SettlementModel } from './pair-policy';

export type Side = 'buy' | 'sell';

/** Which rail is acceptable for paying the publication (seeder) fee. */
export type FeeRail = 'webcash' | 'bitcoin_ark';

/**
 * A traded pair. `base` is the asset being bought/sold; `quote` is what it is
 * priced in. Price is expressed as quote-per-base.
 */
export interface TradingPair {
	base: AssetClass;
	quote: AssetClass;
}

/**
 * A signed limit order as observed in the orderbook torrent. The module only
 * ever holds the public form: the maker's verifying key + fingerprint, the
 * signed-commitment bytes, amounts, and price — no secret.
 */
export interface LimitOrder {
	/** 16-byte order id, hex. */
	id: string;
	pair: TradingPair;
	side: Side;
	/** Price in quote units per 1 base unit (integer atomic ratio scaled). */
	price: number;
	/** Remaining base amount available to fill, in atomic base units. */
	amount: number;
	/** Maker's 20-byte PGP fingerprint, hex. */
	makerFingerprint: string;
	/** Maker's 32-byte ed25519 verifying key, hex. */
	makerVk: string;
	/** Unix seconds after which the order is expired/ignored. */
	expiresAt: number;
	/** Unix seconds the order was observed locally (freshness). */
	observedAt: number;
	/** Source channel the order was seen on. */
	source: OrderSource;
	/** Opaque signed-commitment bytes (rkyv `Signed` envelope), base64. */
	signedCommitment: string;
}

export type OrderSource = 'torrent' | 'dhtx' | 'peer' | 'mock';

/** An exact fill request the taker sends against one maker order. */
export interface FillRequest {
	orderId: string;
	makerFingerprint: string;
	makerVk: string;
	pair: TradingPair;
	side: Side;
	/** Atomic base amount this fill consumes from the maker order. */
	fillAmount: number;
	/** The price this fill executes at (the maker's posted price). */
	price: number;
}

/** Result of walking the book for a market order. */
export interface MarketWalk {
	fills: FillRequest[];
	/** Total base amount that will be filled across all fills. */
	filledAmount: number;
	/** Base amount left unfilled (requested - filled). */
	remainingAmount: number;
	/** Total quote spent/received across fills. */
	totalQuote: number;
	/** Why the walk stopped. */
	stop: WalkStop;
}

export type WalkStop =
	// Fully filled the requested amount.
	| 'filled'
	// Ran out of book liquidity at acceptable prices.
	| 'book-exhausted'
	// Next order's price exceeded the slippage bound.
	| 'slippage'
	// Adding the next fill would breach the quote cap.
	| 'cap';

/** A seeder eligible to receive a share of the publication fee. */
export interface Seeder {
	/** 20-byte fingerprint, hex. */
	fingerprint: string;
	/** Rail this seeder accepts its fee on. */
	rail: FeeRail;
	/** Whether the seeder is currently active (seeding chunks). */
	active: boolean;
}

/** One seeder's computed fee share + (later) its receipt. */
export interface FeeShare {
	seederFingerprint: string;
	rail: FeeRail;
	/** Atomic quote/base units owed to this seeder. */
	amount: number;
	/** Receipt id once paid (16-byte hex); empty until paid. */
	receiptId: string;
}

export interface PublicationFee {
	/** Whether publishing is allowed (false when no active seeders). */
	allowed: boolean;
	/** Total fee in atomic units (0.1% of order value). */
	totalFee: number;
	/** Per-seeder shares (split equally). */
	shares: FeeShare[];
	/** Machine reason when blocked. */
	blockedReason?: 'no-active-seeders' | 'unsupported-fee-rail';
}

// ── Trade timeline ────────────────────────────────────────────────────────────

/**
 * Trade lifecycle phases. Mirrors the referee timeline in the dev-plan, plus
 * the local taker-side pre-states. Every transition is driven by a mocked (or
 * real) referee/rail event — push delivery is never treated as proof.
 */
export type TradePhase =
	| 'order-selected'
	| 'request-sent'
	| 'maker-response'
	| 'proof-precheck'
	| 'delivery-dispatched'
	| 'post-check'
	| 'ark-release'
	| 'settled'
	| 'refunded'
	| 'failed'
	| 'canceled';

export const TERMINAL_PHASES: ReadonlySet<TradePhase> = new Set<TradePhase>([
	'settled',
	'refunded',
	'failed',
	'canceled'
]);

export interface TimelineEvent {
	phase: TradePhase;
	at: number; // unix seconds
	/** Public, redaction-safe note. Never a secret. */
	note: string;
}

export interface Trade {
	/** 16-byte swap id, hex. */
	swapId: string;
	pair: TradingPair;
	side: Side;
	amount: number;
	price: number;
	settlementModel: SettlementModel;
	requiresReferee: boolean;
	phase: TradePhase;
	timeline: TimelineEvent[];
	createdAt: number;
	updatedAt: number;
}
