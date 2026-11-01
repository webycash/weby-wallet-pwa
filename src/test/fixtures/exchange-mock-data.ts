// TEST-ONLY mock orderbook + seeder data (audit M8: lives under src/test/,
// never imported by production modules; see scripts/check-no-test-code.mjs).
//
// This is DEVELOPMENT scaffolding: real orders arrive from the Extro orderbook
// torrent/DHTX after signature + expiry + pair-policy verification, and real
// seeders are discovered from the torrent swarm. Both are DEFERRED integration
// items. The shapes here match the production types exactly so the UI and
// stores are exercised end-to-end.

import { bytesToB64, bytesToHex } from '$lib/modules/webycash-exchange/push-hooks';
import { MARKET_PAIRS, assetClassesOf, pairKey } from '$lib/modules/webycash-exchange/pairs';
import type { LimitOrder, Seeder, TradingPair } from '$lib/modules/webycash-exchange/types';

const randBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

const nowSec = () => Math.floor(Date.now() / 1000);

/** Test alias for the production market list. */
export const MOCK_PAIRS: TradingPair[] = MARKET_PAIRS;

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

export { pairKey, assetClassesOf };
