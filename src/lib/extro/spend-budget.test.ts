import { describe, expect, it } from 'vitest';
import type { ConnectedApp, Connection, Op } from '@extro/node';
import { clearBudget, pruneBudgets, setBudget, spendBudget, viewBudget, watsToWebcash } from './spend-budget';

const RAIL = 'https://webcash.example';
const APP: ConnectedApp = { origin: 'https://app.example', name: 'App', max_tier: 'act' };
const ID = 'ab'.repeat(16);
const conn = (over: Partial<Connection> = {}): Connection => ({ id_hex: ID, aud: APP.origin, scopes: [], connected_at: 1, revoked_at: null, ...over });
const pay = (amount = '0.0001', server_url = RAIL, inputs: string[] = []): Op =>
	({ kind: 'Rail', cmd: { op: 'PayWebcash', amount, inputs, server_url } }) as Op;

function memory() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
		get length() {
			return m.size;
		},
		key: (i: number) => [...m.keys()][i] ?? null
	};
}

describe('spend budgets (doc 13 §3.4 amount_caps)', () => {
	it('no budget → nothing is held (the user is asked)', async () => {
		const b = spendBudget({ storage: memory(), serverUrl: () => RAIL });
		expect(await b.reserve(APP, conn(), pay())).toBeNull();
	});

	it('holds covered spends up to the cap per window, then asks; the window rolls', async () => {
		const storage = memory();
		let t = 1_000_000;
		setBudget(storage, ID, '0.00025', 3600, t);
		const b = spendBudget({ storage, serverUrl: () => RAIL + '/', now: () => t });
		const r1 = await b.reserve(APP, conn(), pay());
		const r2 = await b.reserve(APP, conn(), pay());
		expect(r1 && r2).toBeTruthy();
		// A held amount counts before it settles: no third spend.
		expect(await b.reserve(APP, conn(), pay())).toBeNull();
		await r1!.commit();
		await r2!.cancel();
		expect(viewBudget(storage, ID, t)).toEqual({ amount: '0.00025', window_secs: 3600, used: '0.0001', remaining: '0.00015' });
		expect(await b.reserve(APP, conn(), pay('0.0002'))).toBeNull();
		t += 3601;
		expect(await b.reserve(APP, conn(), pay('0.0002'))).toBeTruthy();
	});

	it('covers only wallet-funded PayWebcash on the wallet\'s own server, on a live connection', async () => {
		const storage = memory();
		setBudget(storage, ID, '1');
		const b = spendBudget({ storage, serverUrl: () => RAIL });
		expect(await b.reserve(APP, conn(), pay('0.1', 'https://evil.example'))).toBeNull();
		expect(await b.reserve(APP, conn(), pay('0.1', RAIL, ['e0.1:secret:' + 'aa'.repeat(32)]))).toBeNull();
		expect(await b.reserve(APP, conn(), { kind: 'Rail', cmd: { op: 'MintWebcash', index: 0, amount: '0.1', server_url: RAIL } } as unknown as Op)).toBeNull();
		expect(await b.reserve(APP, conn(), pay('nope'))).toBeNull();
		expect(await b.reserve(APP, conn({ revoked_at: 5 }), pay('0.1'))).toBeNull();
		expect(await b.reserve(APP, conn({ id_hex: 'cd'.repeat(16) }), pay('0.1'))).toBeNull();
	});

	it('rejects bad caps, fails closed on a corrupt entry, clears and prunes', async () => {
		const storage = memory();
		expect(() => setBudget(storage, ID, '0')).toThrow();
		expect(() => setBudget(storage, ID, '-1')).toThrow();
		expect(() => setBudget(storage, 'xyz', '1')).toThrow();
		storage.setItem('extro.spend-budget/v1|' + ID, '{"v":1,"rail":"webcash","amount_wats":"1e9"}');
		expect(viewBudget(storage, ID)).toBeNull();
		setBudget(storage, ID, '1');
		setBudget(storage, 'cd'.repeat(16), '1');
		pruneBudgets(storage, [ID]);
		expect(viewBudget(storage, ID)).not.toBeNull();
		expect(viewBudget(storage, 'cd'.repeat(16))).toBeNull();
		clearBudget(storage, ID);
		expect(viewBudget(storage, ID)).toBeNull();
	});

	it('formats wats as webcash', () => {
		expect(watsToWebcash(10_000n)).toBe('0.0001');
		expect(watsToWebcash(150_000_000n)).toBe('1.5');
		expect(watsToWebcash(0n)).toBe('0');
	});
});
