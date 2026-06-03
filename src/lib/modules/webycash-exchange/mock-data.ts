// Mock orderbook + seeder data for dev and the default mock adapter.
//
// This is DEVELOPMENT scaffolding: real orders arrive from the Extro orderbook
// torrent/DHTX after signature + expiry + pair-policy verification, and real
// seeders are discovered from the torrent swarm. Both are DEFERRED integration
// items. The shapes here match the production types exactly so the UI and
// stores are exercised end-to-end.

import { bytesToB64, bytesToHex } from './push-hooks';
import type { AssetClass } from './pair-policy';
import type { LimitOrder, Seeder, TradingPair } from './types';

const randBytes = (n: number): Uint8Array => {
	const b = new Uint8Array(n);
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
	else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
	return b;
};

const nowSec = () => Math.floor(Date.now() / 1000);

/** A handful of pairs the exchange surfaces in the mock book. */
export const MOCK_PAIRS: TradingPair[] = [
	{ base: 'BitcoinArk', quote: 'Webcash' },
	{ base: 'Rgb20', quote: 'BitcoinArk' },
	{ base: 'Rgb21', quote: 'BitcoinArk' },
	{ base: 'Rgb20', quote: 'Webcash' },
	// Intentionally include a BLOCKED pair so the UI can demonstrate the gate.
	{ base: 'Webcash', quote: 'Voucher' }
];

const FP = () => bytesToHex(randBytes(20));
const VK = () => bytesToHex(randBytes(32));

const mkOrder = (
	pair: TradingPair,
	side: 'buy' | 'sell',
	price: number,
	amount: number
): LimitOrder => ({
	id: bytesToHex(randBytes(16)),
	pair,
	side,
	price,
	amount,
	makerFingerprint: FP(),
	makerVk: VK(),
	expiresAt: nowSec() + 3600,
	observedAt: nowSec() - Math.floor(Math.random() * 120),
	source: 'mock',
	signedCommitment: bytesToB64(randBytes(64))
});

/** Generate a plausible two-sided book around `mid` for a pair. */
export function mockBook(pair: TradingPair, mid = 100): LimitOrder[] {
	const orders: LimitOrder[] = [];
	for (let i = 1; i <= 6; i++) {
		orders.push(mkOrder(pair, 'buy', +(mid - i * (mid * 0.004)).toFixed(2), 50 + i * 17));
		orders.push(mkOrder(pair, 'sell', +(mid + i * (mid * 0.004)).toFixed(2), 50 + i * 13));
	}
	return orders;
}

/** Generate `n` active seeders on allowed fee rails. */
export function mockSeeders(n: number): Seeder[] {
	const rails = ['webcash', 'bitcoin_ark'] as const;
	return Array.from({ length: n }, (_, i) => ({
		fingerprint: FP(),
		rail: rails[i % rails.length],
		active: true
	}));
}

export const pairKey = (p: TradingPair): string => `${p.base}/${p.quote}`;

export const assetClassesOf = (p: TradingPair): [AssetClass, AssetClass] => [p.base, p.quote];
