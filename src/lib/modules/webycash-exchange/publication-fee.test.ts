import { describe, it, expect } from 'vitest';
import {
	computePublicationFee,
	perSeederFeePercent,
	totalPublicationFee,
	isAllowedFeeRail
} from './publication-fee';
import type { Seeder } from './types';

const seeder = (fp: string, rail: Seeder['rail'] = 'webcash', active = true): Seeder => ({
	fingerprint: fp,
	rail,
	active
});

describe('publication fee: total is 0.1% of order value', () => {
	it('computes 0.1% (10 bps)', () => {
		expect(totalPublicationFee(1_000_000)).toBe(1000); // 0.1%
		expect(totalPublicationFee(100_000)).toBe(100);
	});
});

describe('publication fee: equal split among active seeders', () => {
	const ORDER = 1_000_000; // total fee = 1000

	it('1 seeder gets 0.1% (the whole fee)', () => {
		const fee = computePublicationFee(ORDER, [seeder('01')]);
		expect(fee.allowed).toBe(true);
		expect(fee.totalFee).toBe(1000);
		expect(fee.shares.length).toBe(1);
		expect(fee.shares[0].amount).toBe(1000);
		expect(perSeederFeePercent(1)).toBeCloseTo(0.1, 9);
	});

	it('2 seeders get 0.05% each', () => {
		const fee = computePublicationFee(ORDER, [seeder('01'), seeder('02')]);
		expect(fee.allowed).toBe(true);
		expect(fee.shares.map((s) => s.amount)).toEqual([500, 500]);
		expect(perSeederFeePercent(2)).toBeCloseTo(0.05, 9);
	});

	it('10 seeders get 0.01% each', () => {
		const seeders = Array.from({ length: 10 }, (_, i) => seeder(String(i).padStart(2, '0')));
		const fee = computePublicationFee(ORDER, seeders);
		expect(fee.allowed).toBe(true);
		expect(fee.shares.length).toBe(10);
		expect(fee.shares.every((s) => s.amount === 100)).toBe(true);
		expect(perSeederFeePercent(10)).toBeCloseTo(0.01, 9);
	});

	it('distributes integer remainder so shares sum exactly to total', () => {
		// 1000 / 3 = 333 r1 → 334, 333, 333
		const fee = computePublicationFee(ORDER, [seeder('01'), seeder('02'), seeder('03')]);
		expect(fee.shares.map((s) => s.amount)).toEqual([334, 333, 333]);
		expect(fee.shares.reduce((a, s) => a + s.amount, 0)).toBe(1000);
	});

	it('ignores inactive seeders when splitting', () => {
		const fee = computePublicationFee(ORDER, [
			seeder('01'),
			seeder('02', 'webcash', false), // inactive
			seeder('03')
		]);
		expect(fee.shares.length).toBe(2);
		expect(fee.shares.map((s) => s.amount)).toEqual([500, 500]);
	});
});

describe('publication fee: 0 seeders blocks publishing', () => {
	it('blocks with no-active-seeders when there are none', () => {
		const fee = computePublicationFee(1_000_000, []);
		expect(fee.allowed).toBe(false);
		expect(fee.blockedReason).toBe('no-active-seeders');
		expect(fee.shares).toEqual([]);
	});

	it('blocks when every seeder is inactive', () => {
		const fee = computePublicationFee(1_000_000, [seeder('01', 'webcash', false)]);
		expect(fee.allowed).toBe(false);
		expect(fee.blockedReason).toBe('no-active-seeders');
	});
});

describe('publication fee: only Webcash and Bitcoin ARK rails allowed', () => {
	it('accepts webcash and bitcoin_ark', () => {
		expect(isAllowedFeeRail('webcash')).toBe(true);
		expect(isAllowedFeeRail('bitcoin_ark')).toBe(true);
	});

	it('rejects any other rail', () => {
		expect(isAllowedFeeRail('voucher')).toBe(false);
		expect(isAllowedFeeRail('rgb20')).toBe(false);
		expect(isAllowedFeeRail('lightning')).toBe(false);
	});

	it('blocks publishing when an active seeder requests an unsupported rail', () => {
		const fee = computePublicationFee(1_000_000, [
			seeder('01', 'webcash'),
			seeder('02', 'voucher' as any)
		]);
		expect(fee.allowed).toBe(false);
		expect(fee.blockedReason).toBe('unsupported-fee-rail');
	});
});
