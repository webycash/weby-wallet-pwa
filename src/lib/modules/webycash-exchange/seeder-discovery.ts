/**
 * Provisional seeder discovery from DHTX-visible peers.
 *
 * Full seeder registry / chunk-seeding protocol is still open. Until then,
 * active seeders for the publication fee are the distinct maker fingerprints
 * observed on the live DHTX book while at least one peer DataChannel is open.
 * Zero peers ⇒ empty list ⇒ publish stays blocked with `no-active-seeders`.
 */

import type { LimitOrder, Seeder } from './types';

export function discoverSeedersFromDhtx(input: {
	orders: readonly LimitOrder[];
	peersConnected: number;
	rail?: Seeder['rail'];
}): Seeder[] {
	if (input.peersConnected <= 0) return [];
	const rail = input.rail ?? 'webcash';
	const seen = new Set<string>();
	const seeders: Seeder[] = [];
	for (const order of input.orders) {
		if (order.source !== 'dhtx' && order.source !== 'peer') continue;
		const fp = order.makerFingerprint.toLowerCase();
		if (!/^[0-9a-f]{40}$/.test(fp) || seen.has(fp)) continue;
		seen.add(fp);
		seeders.push({ fingerprint: fp, rail, active: true });
	}
	return seeders;
}
