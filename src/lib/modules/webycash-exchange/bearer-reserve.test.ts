import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/extro/rail', () => ({ webcashReserve: vi.fn() }));
vi.mock('$lib/stores/wallet.svelte', () => ({ insertWebcashIntoWebcashWallet: vi.fn(), payWebcashFromWebcashWallet: vi.fn() }));
import { reserveBearerLeg, webcashToWats, type BearerReserveDeps } from './bearer-reserve';

const PUB = `e1:public:${'ab'.repeat(32)}`;
const args = { index: 0, amount: '1', publicToken: PUB, serverUrl: 'https://wc.test', maxWebcash: '1' };
function deps(over: Partial<BearerReserveDeps> = {}) {
	const d = {
		status: vi.fn(async () => 'absent' as const),
		pay: vi.fn(async () => ({ ok: true as const, value: 'e1:secret:paid' })),
		insert: vi.fn(async () => ({ ok: true as const, value: undefined })),
		reserve: vi.fn(async () => ({
			state: 'ok' as const,
			value: { kind: 'WebcashReserved', secret: 'x', public_token: PUB, change: null, index: 0, unspent: true, replaced: true }
		})),
		...over
	};
	return d as typeof d & BearerReserveDeps;
}

describe('bearer leg reserve (e1 per direction)', () => {
	it('converts decimal webcash to wats exactly', () => {
		expect(webcashToWats('1')).toBe(100_000_000n);
		expect(webcashToWats('0.00000001')).toBe(1n);
		expect(() => webcashToWats('1e3')).toThrow();
		expect(() => webcashToWats('0')).toThrow();
	});

	it('pays exactly 1 webcash into the bearer scalar before the swap', async () => {
		const d = deps();
		const r = await reserveBearerLeg(args, d);
		expect(r.reused).toBe(false);
		expect(d.pay).toHaveBeenCalledWith(100_000_000);
		expect(d.reserve).toHaveBeenCalledWith({ index: 0, amount: '1', inputs: ['e1:secret:paid'], serverUrl: 'https://wc.test' });
		expect(d.insert).not.toHaveBeenCalled();
	});

	it('is idempotent: an unspent reservation is reused with no wallet spend', async () => {
		const d = deps({ status: vi.fn(async () => 'unspent' as const) });
		expect((await reserveBearerLeg(args, d)).reused).toBe(true);
		expect(d.pay).not.toHaveBeenCalled();
	});

	it('refuses a SPENT scalar and amounts over the per-direction cap', async () => {
		await expect(reserveBearerLeg(args, deps({ status: vi.fn(async () => 'spent' as const) }))).rejects.toThrow(/SPENT/);
		const d = deps();
		await expect(reserveBearerLeg({ ...args, amount: '2' }, d)).rejects.toThrow(/cap/);
		expect(d.pay).not.toHaveBeenCalled();
	});

	it('re-inserts the paid secret when the reserve fails (no value stranded)', async () => {
		const d = deps({ reserve: vi.fn(async () => ({ state: 'error' as const, message: 'server 500' })) as never });
		await expect(reserveBearerLeg(args, d)).rejects.toThrow(/re-inserted/);
		expect(d.insert).toHaveBeenCalledWith('e1:secret:paid');
	});

	it('stores change and rejects a reservation of a different token', async () => {
		const d = deps({
			reserve: vi.fn(async () => ({
				state: 'ok' as const,
				value: { kind: 'WebcashReserved', secret: 'x', public_token: PUB, change: 'e0.5:secret:chg', index: 0, unspent: true, replaced: true }
			})) as never
		});
		await reserveBearerLeg(args, d);
		expect(d.insert).toHaveBeenCalledWith('e0.5:secret:chg');
		const bad = deps({
			reserve: vi.fn(async () => ({
				state: 'ok' as const,
				value: { kind: 'WebcashReserved', secret: 'x', public_token: 'e1:public:' + 'cd'.repeat(32), change: null, index: 0, unspent: true, replaced: true }
			})) as never
		});
		await expect(reserveBearerLeg(args, bad)).rejects.toThrow(/not the unspent swap bearer leg/);
		expect(bad.insert).toHaveBeenCalledWith('e1:secret:paid');
	});
});
