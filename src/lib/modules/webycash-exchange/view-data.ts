// Presentation helpers + deterministic mock series for the exchange views.
//
// Pure + immutable: same input => same output, no state, no side effects. The
// mock candle series and the peer/agent counts are placeholders until the real
// data arrives from the extro orderbook torrent (observed trades) and the
// DHTX/keyserver peer set. Swapping the source never touches the views.

import type { AssetClass } from './pair-policy';
import type { TradingPair } from './types';

// ── Labels (precise asset names — never lump "Webcash/Voucher") ───────────────

const ASSET_LABELS: Record<AssetClass, string> = {
	Webcash: 'Webcash',
	Voucher: 'Voucher',
	BitcoinArk: 'Bitcoin ARK',
	Rgb20: 'RGB20',
	Rgb21: 'RGB21',
	Custom: 'Custom'
};

export const assetLabel = (a: AssetClass): string => ASSET_LABELS[a] ?? String(a);

/** "Bitcoin ARK ⇄ Webcash" — base then quote, never merged. */
export const pairLabel = (p: TradingPair): string =>
	`${assetLabel(p.base)} ⇄ ${assetLabel(p.quote)}`;

/** Stable key for a pair, for #each / selection. */
export const pairKey = (p: TradingPair): string => `${p.base}/${p.quote}`;

// ── Deterministic mock candles ────────────────────────────────────────────────

export interface Candle {
	readonly t: number;
	readonly o: number;
	readonly h: number;
	readonly l: number;
	readonly c: number;
}

const hash = (s: string): number => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

const mulberry32 = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A deterministic OHLC series for a pair (seeded by base/quote), so the chart
 * is stable across renders. Replaced by observed-trade buckets from the torrent.
 */
export const mockCandles = (pair: TradingPair, n = 48): Candle[] => {
	const rnd = mulberry32(hash(pairKey(pair)));
	// Anchor price by quote so different pairs sit at sane levels.
	let price = pair.quote === 'Webcash' ? 1000 : pair.quote === 'BitcoinArk' ? 0.025 : 100;
	const out: Candle[] = [];
	let t = Math.floor(Date.now() / 1000) - n * 900; // 15-min buckets
	for (let i = 0; i < n; i++) {
		const drift = (rnd() - 0.48) * price * 0.03;
		const o = price;
		const c = Math.max(price * 0.5, o + drift);
		const hi = Math.max(o, c) * (1 + rnd() * 0.012);
		const lo = Math.min(o, c) * (1 - rnd() * 0.012);
		out.push({ t, o, h: hi, l: lo, c });
		price = c;
		t += 900;
	}
	return out;
};

/** Latest close from a series (the "last price"). */
export const lastPrice = (candles: readonly Candle[]): number =>
	candles.length ? candles[candles.length - 1].c : 0;

// ── Mock extro-network participants (PA2AP: peers + agents) ────────────────────

export interface NetworkSnapshot {
	/** Human peers currently reachable. */
	readonly peers: number;
	/** Autonomous agents currently reachable. */
	readonly agents: number;
	/** Seeders carrying chunks for the selected market. */
	readonly seeders: number;
	/** Where the observed orderbook came from. */
	readonly source: 'torrent' | 'dhtx' | 'peer' | 'mock';
}

/** Deterministic mock peer/agent counts until DHTX/keyserver wiring lands. */
export const mockNetwork = (pair: TradingPair, seeders: number): NetworkSnapshot => {
	const rnd = mulberry32(hash(pairKey(pair)) ^ 0x9e3779b9);
	return {
		peers: 6 + Math.floor(rnd() * 18),
		agents: 2 + Math.floor(rnd() * 12),
		seeders,
		source: 'mock'
	};
};
