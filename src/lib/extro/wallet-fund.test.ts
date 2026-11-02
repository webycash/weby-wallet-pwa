import { describe, expect, it, vi } from 'vitest';
import type { ExtroResponse, Op } from '@extro/node';
import { fundFromWallet, type WalletFundDeps } from './wallet-fund';

const RAIL = 'https://webcash.example';
const pay = (inputs: string[] = [], server_url = RAIL, amount = '0.001'): Op =>
	({ kind: 'Rail', cmd: { op: 'PayWebcash', amount, inputs, server_url } }) as Op;
const exact = 'e0.001:secret:' + 'aa'.repeat(32);
const paidBody = (change: string | null = null, unspent = true) => ({
	kind: 'Ok',
	request_id: new Uint8Array(16),
	body: { kind: 'WebcashPaid', secret: 'e0.001:secret:' + 'bb'.repeat(32), public_token: 'p', change, unspent, replaced: true }
}) as unknown as ExtroResponse;

function deps(over: Partial<WalletFundDeps> = {}) {
	return {
		serverUrl: () => RAIL + '/',
		pay: vi.fn(async () => ({ ok: true as const, value: exact })),
		insert: vi.fn(async () => ({ ok: true as const, value: undefined })),
		...over
	};
}

describe('fundFromWallet (wallet-funded PayWebcash)', () => {
	it('pays the exact amount from the wallet and runs the op with that input', async () => {
		const d = deps();
		const run = vi.fn(async () => paidBody());
		const out = await fundFromWallet(pay(), run, d);
		expect(d.pay).toHaveBeenCalledWith(100_000);
		expect(run).toHaveBeenCalledWith(pay([exact]));
		expect(out).toMatchObject({ kind: 'Ok', body: { kind: 'WebcashPaid' } });
		expect(d.insert).not.toHaveBeenCalled();
	});

	it('leaves other ops and app-funded payments alone', async () => {
		const run = vi.fn();
		expect(await fundFromWallet({ kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot: 0 } } as Op, run, deps())).toBeNull();
		expect(await fundFromWallet(pay([exact]), run, deps())).toBeNull();
		expect(run).not.toHaveBeenCalled();
	});

	it('never sends wallet secrets to another server', async () => {
		const d = deps();
		const run = vi.fn();
		const out = await fundFromWallet(pay([], 'https://evil.example'), run, d);
		expect(out).toMatchObject({ kind: 'Err', code: 'PolicyRejected' });
		expect(d.pay).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
	});

	it('re-inserts the funds when the payment fails, and stores change', async () => {
		const d = deps();
		const failed = await fundFromWallet(pay(), async () => ({ kind: 'Err', request_id: new Uint8Array(16), code: 'Rail', message: 'down' }) as ExtroResponse, d);
		expect(failed).toMatchObject({ kind: 'Err', code: 'WalletError' });
		expect(d.insert).toHaveBeenCalledWith(exact);
		const d2 = deps();
		await fundFromWallet(pay(), async () => paidBody('e0.1:secret:' + 'cc'.repeat(32)), d2);
		expect(d2.insert).toHaveBeenCalledWith('e0.1:secret:' + 'cc'.repeat(32));
	});

	it('refuses a malformed amount before touching the wallet', async () => {
		const d = deps();
		expect(await fundFromWallet(pay([], RAIL, '-1'), vi.fn(), d)).toMatchObject({ kind: 'Err', code: 'MalformedCommand' });
		expect(d.pay).not.toHaveBeenCalled();
	});
});
