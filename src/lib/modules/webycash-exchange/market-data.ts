// Real exchange market data — NO mocks.
//
// Candles are OHLC of the OBSERVED order-book mid-price over time buckets, and
// volume is the observed resting depth (sum of bid + ask amounts). Each poll of
// the DHTX order book (`refreshBook`) records one observation, persisted
// per-pair in localStorage, so the series is genuine *historic data of the
// book* that accumulates as it is observed. There is no synthetic/seeded data:
// a never-observed pair has an EMPTY series (the chart shows "awaiting data"),
// and we never fabricate a price when the book is empty.

import { pairKey } from './mock-data';
import type { TradingPair } from './types';

export interface Candle {
	readonly t: number; // bucket start, unix seconds
	readonly o: number;
	readonly h: number;
	readonly l: number;
	readonly c: number;
	readonly v: number; // observed resting depth in the bucket (base units)
}

interface Obs {
	t: number; // unix seconds
	m: number; // observed mid price
	v: number; // observed resting depth (sum of bid+ask amounts)
}

const LS = (pk: string) => `weby.mktdata.${pk}`;
const CAP = 4000; // ~ many days of minutely observations

function load(pk: string): Obs[] {
	try {
		const raw = localStorage.getItem(LS(pk));
		return raw ? (JSON.parse(raw) as Obs[]) : [];
	} catch {
		return [];
	}
}

function persist(pk: string, obs: Obs[]): void {
	try {
		localStorage.setItem(LS(pk), JSON.stringify(obs.slice(-CAP)));
	} catch {
		/* storage full / unavailable — drop silently */
	}
}

/**
 * Record one real observation of the book. No-op when the book has no live mid
 * (empty book) — we never invent a price. Called from `refreshBook` after each
 * DHTX poll. Coalesces multiple observations within the same second.
 */
export function recordObservation(pair: TradingPair, mid: number | null, depthVolume: number): void {
	if (mid == null || !Number.isFinite(mid) || mid <= 0) return;
	const pk = pairKey(pair);
	const obs = load(pk);
	const t = Math.floor(Date.now() / 1000);
	const last = obs[obs.length - 1];
	if (last && last.t === t) {
		last.m = mid;
		last.v = depthVolume;
	} else {
		obs.push({ t, m: mid, v: Number.isFinite(depthVolume) ? depthVolume : 0 });
	}
	persist(pk, obs);
}

/**
 * OHLC + depth candles bucketed from the real observation series. Empty until
 * the book has been observed with a live mid price.
 */
export function candles(pair: TradingPair, bucketSec = 900, n = 60): Candle[] {
	const obs = load(pairKey(pair));
	if (obs.length === 0) return [];
	const byBucket = new Map<number, Obs[]>();
	for (const o of obs) {
		const b = Math.floor(o.t / bucketSec) * bucketSec;
		const arr = byBucket.get(b);
		if (arr) arr.push(o);
		else byBucket.set(b, [o]);
	}
	const out: Candle[] = [];
	for (const [t, os] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
		const ms = os.map((o) => o.m);
		out.push({
			t,
			o: ms[0],
			c: ms[ms.length - 1],
			h: Math.max(...ms),
			l: Math.min(...ms),
			v: os.reduce((s, o) => s + o.v, 0) / os.length
		});
	}
	return out.slice(-n);
}

/** Most recent observed close, or `null` if the book has never had a mid. */
export function lastObservedPrice(pair: TradingPair): number | null {
	const obs = load(pairKey(pair));
	return obs.length ? obs[obs.length - 1].m : null;
}

/** Average observed resting depth over the trailing window (book liquidity). */
export function observedDepthVolume(pair: TradingPair, windowSec = 86400): number {
	const obs = load(pairKey(pair));
	if (!obs.length) return 0;
	const cutoff = Math.floor(Date.now() / 1000) - windowSec;
	const recent = obs.filter((o) => o.t >= cutoff);
	if (!recent.length) return 0;
	return recent.reduce((s, o) => s + o.v, 0) / recent.length;
}
