// Seeder publication-fee calculator.
//
// Source of truth:
//   extro/docs/development/24-extro-402-scheme-and-webycash-plan.md
//   §"Reusable 402 Scheme Families" 7. Seeder publish fee.
//
// Rules:
//   * Publishing an order pays the ACTIVE seeders that will seed its chunks.
//   * Total fee is 0.1% of order value.
//   * The fee is split EQUALLY among active seeders:
//       1 seeder  → 0.1%   each
//       2 seeders → 0.05%  each
//       10 seeders → 0.01% each
//   * 0 active seeders → publishing is BLOCKED (there is no one to seed it).
//   * Accepted fee rails: Webcash or Bitcoin ARK ONLY. Any other rail is
//     rejected (publishing blocked).

import type { FeeRail, FeeShare, PublicationFee, Seeder } from './types';

/** Basis points the total publication fee represents: 0.1% = 10 bps. */
export const PUBLICATION_FEE_BPS = 10;

/** The only rails accepted for a publication fee. */
export const ALLOWED_FEE_RAILS: ReadonlySet<FeeRail> = new Set<FeeRail>(['webcash', 'bitcoin_ark']);

export const isAllowedFeeRail = (rail: string): rail is FeeRail =>
	ALLOWED_FEE_RAILS.has(rail as FeeRail);

/** Total fee for an order value = 0.1% (rounded down to atomic units). */
export const totalPublicationFee = (orderValue: number): number =>
	Math.floor((orderValue * PUBLICATION_FEE_BPS) / 10_000);

/**
 * Compute the publication fee plan for `orderValue`, split equally among the
 * ACTIVE seeders in `seeders`. Inactive seeders are ignored.
 *
 * Returns `{ allowed: false, blockedReason }` when there are no active seeders
 * or any active seeder requests an unsupported fee rail.
 *
 * The equal split distributes any integer remainder to the first shares so the
 * shares sum EXACTLY to the total fee (no dust lost or created).
 */
export function computePublicationFee(orderValue: number, seeders: readonly Seeder[]): PublicationFee {
	const active = seeders.filter((s) => s.active);

	if (active.length === 0) {
		return { allowed: false, totalFee: 0, shares: [], blockedReason: 'no-active-seeders' };
	}

	// Enforce rail allowlist on every active seeder.
	if (active.some((s) => !isAllowedFeeRail(s.rail))) {
		return {
			allowed: false,
			totalFee: totalPublicationFee(orderValue),
			shares: [],
			blockedReason: 'unsupported-fee-rail'
		};
	}

	const totalFee = totalPublicationFee(orderValue);
	const base = Math.floor(totalFee / active.length);
	let remainder = totalFee - base * active.length;

	const shares: FeeShare[] = active.map((s) => {
		let amount = base;
		if (remainder > 0) {
			amount += 1;
			remainder -= 1;
		}
		return { seederFingerprint: s.fingerprint, rail: s.rail, amount, receiptId: '' };
	});

	return { allowed: true, totalFee, shares };
}

/**
 * The per-seeder fee fraction (of order value) as a percentage, for UI preview.
 * 1 seeder → 0.1, 2 → 0.05, 10 → 0.01. Returns 0 for no active seeders.
 */
export function perSeederFeePercent(activeSeederCount: number): number {
	if (activeSeederCount <= 0) return 0;
	// 0.1% total / n, expressed as a percent.
	return (PUBLICATION_FEE_BPS / 100) / activeSeederCount;
}
