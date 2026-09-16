import { describe, it, expect } from 'vitest';
import { ExtroClient } from '$lib/extro/client';
import { MockExtroAdapter } from '$lib/extro/mock-node';
import { publishOrderFee } from './publish';
import type { Seeder } from './types';

const client = () => new ExtroClient(new MockExtroAdapter());

const seeder = (fp: string, rail: Seeder['rail'] = 'webcash', active = true): Seeder => ({
	fingerprint: fp,
	rail,
	active
});

describe('publish-order fee flow', () => {
	it('pays each active seeder and attaches a receipt id', async () => {
		const res = await publishOrderFee(client(), {
			orderValue: 1_000_000,
			seeders: [seeder('01'), seeder('02', 'bitcoin_ark')],
			slot: 0
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.shares.length).toBe(2);
			expect(res.shares.every((s) => s.receiptId.length === 32)).toBe(true); // 16 bytes hex
			expect(res.shares.map((s) => s.amount)).toEqual([500, 500]);
		}
	});

	it('blocks (and pays no one) with zero active seeders', async () => {
		const adapter = new MockExtroAdapter();
		const c = new ExtroClient(adapter);
		const res = await publishOrderFee(c, { orderValue: 1_000_000, seeders: [], slot: 0 });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe('no-active-seeders');
		expect(adapter.calls).toBe(0); // never dispatched a payment
	});

	it('blocks when a seeder requests an unsupported rail', async () => {
		const res = await publishOrderFee(client(), {
			orderValue: 1_000_000,
			seeders: [seeder('01'), seeder('02', 'voucher' as any)],
			slot: 0
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe('unsupported-fee-rail');
	});

	it('fee payments are serialized through the single-flight facade', async () => {
		const adapter = new MockExtroAdapter();
		const c = new ExtroClient(adapter);
		await publishOrderFee(c, {
			orderValue: 1_000_000,
			seeders: Array.from({ length: 5 }, (_, i) => seeder(String(i).padStart(2, '0'))),
			slot: 0
		});
		expect(adapter.maxConcurrent).toBe(1);
		expect(adapter.calls).toBe(5);
	});
});
