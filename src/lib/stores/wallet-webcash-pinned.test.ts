import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory persistence + fake WASM: proves exchange webcash ops hit the
// webcash/main MemStore even when the UI's active family is bitcoin (x17 gate:
// "bearer reserve: wallet cannot fund 1 webcash (Insufficient funds)").
const db = new Map<string, string>();
let active = { family: 'bitcoin', label: 'main' };
vi.mock('$lib/core/persistence', () => ({
	walletStateKey: (f: string, l: string) => `wallet:${f}:${l}`,
	loadState: async (n: string, k = 'current') => db.get(`${n}/${k}`) ?? null,
	saveState: async (n: string, s: string, k = 'current') => void db.set(`${n}/${k}`, s),
	getActive: () => active,
	setActive: (_n: string, family: string, label: string) => { active = { family, label }; },
	findEntry: () => undefined,
	getMnemonic: () => null
}));
vi.mock('./network.svelte', () => ({ getNetwork: () => 'production' }));
vi.mock('$lib/extro/runtime-config', () => ({ getRuntimeConfig: () => ({}) }));
vi.mock('$lib/core/webcash-routing', () => ({ resolveWebcashWasmNetwork: () => 'mainnet' }));
const st = (outs: number[]) => JSON.stringify({ meta: {}, depths: {}, outputs: outs.map((amount) => ({ amount, spent: false })) });
const wasm = {
	pay_webcash: vi.fn(async (s: string, _n: string, w: bigint) => {
		const o = JSON.parse(s);
		const total = o.outputs.reduce((a: number, x: { amount: number }) => a + x.amount, 0);
		if (total < Number(w)) throw new Error('Wallet error: Insufficient funds');
		return JSON.stringify({ state: st([total - Number(w)].filter((x) => x > 0)), payment_webcash: `pmt:${w}` });
	}),
	insert_webcash: vi.fn(async (s: string, _n: string, _wc: string) => {
		const o = JSON.parse(s);
		return st([...o.outputs.map((x: { amount: number }) => x.amount), 7]);
	}),
	derive_wallet_secret: () => 'x',
	create_roaming_wallet: () => st([])
};
vi.mock('$lib/core/wasm', () => ({ getWasm: async () => wasm }));

describe('exchange webcash ops are pinned to the webcash family', () => {
	beforeEach(() => {
		db.clear();
		db.set('production/master', 'm');
		db.set('production/wallet:webcash:main', st([100_000_000]));
		db.set('production/wallet:bitcoin:main', st([]));
		active = { family: 'bitcoin', label: 'main' };
	});

	it('exchangeWebcashTarget ignores a non-webcash active family', async () => {
		const { exchangeWebcashTarget } = await import('./wallet.svelte');
		expect(exchangeWebcashTarget('bitcoin', 'main')).toEqual({ family: 'webcash', label: 'main' });
		expect(exchangeWebcashTarget('webcash', 'savings')).toEqual({ family: 'webcash', label: 'savings' });
	});

	it('pays 1 webcash from webcash/main while bitcoin is active (legacy payWebcash fails)', async () => {
		const w = await import('./wallet.svelte');
		await w.setActive('bitcoin', 'main');
		const legacy = await w.payWebcash(100_000_000);
		expect(legacy.ok).toBe(false); // the x17 bug, reproduced
		const r = await w.payWebcashFromWebcashWallet(100_000_000);
		expect(r).toEqual({ ok: true, value: 'pmt:100000000' });
		expect(JSON.parse(db.get('production/wallet:webcash:main')!).outputs).toEqual([]);
		expect(JSON.parse(db.get('production/wallet:bitcoin:main')!).outputs).toEqual([]);
	});

	it('inserts received webcash into webcash/main, not the active bitcoin store', async () => {
		const w = await import('./wallet.svelte');
		await w.setActive('bitcoin', 'main');
		const r = await w.insertWebcashIntoWebcashWallet('e1:secret:redacted');
		expect(r.ok).toBe(true);
		expect(JSON.parse(db.get('production/wallet:webcash:main')!).outputs.map((o: { amount: number }) => o.amount)).toEqual([100_000_000, 7]);
		expect(JSON.parse(db.get('production/wallet:bitcoin:main')!).outputs).toEqual([]);
	});
});
