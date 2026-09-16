import { describe, expect, it } from 'vitest';
import { discoverSeedersFromDhtx } from './seeder-discovery';
import type { LimitOrder } from './types';

const order = (fp: string, source: LimitOrder['source'] = 'dhtx'): LimitOrder => ({
	id: '11'.repeat(16),
	pair: { base: 'BitcoinArk', quote: 'Webcash' },
	side: 'sell',
	price: 1,
	amount: 1,
	makerFingerprint: fp,
	makerVk: '22'.repeat(32),
	expiresAt: 9_999_999_999,
	observedAt: 1,
	source,
	signedCommitment: 'YQ=='
});

describe('discoverSeedersFromDhtx', () => {
	it('returns empty when no peers are connected', () => {
		expect(
			discoverSeedersFromDhtx({
				orders: [order('aa'.repeat(20))],
				peersConnected: 0
			})
		).toEqual([]);
	});

	it('dedupes DHTX maker fingerprints when peers are connected', () => {
		const seeders = discoverSeedersFromDhtx({
			orders: [order('aa'.repeat(20)), order('aa'.repeat(20)), order('bb'.repeat(20))],
			peersConnected: 2
		});
		expect(seeders).toHaveLength(2);
		expect(seeders.map((s) => s.fingerprint)).toEqual(['aa'.repeat(20), 'bb'.repeat(20)]);
		expect(seeders.every((s) => s.active && s.rail === 'webcash')).toBe(true);
	});
});
