import { describe, expect, it, vi } from 'vitest';

vi.mock('./persistence', () => ({ clearMnemonic: vi.fn() }));

import {
	exportMoveBundle,
	homeIsEmpty,
	importMoveBundle,
	MOVED_TO_KEY,
	parseMoveBundle,
	REPROTECT_KEY,
	storeLocation,
	WalletMoveError,
	type MoveStorage
} from './wallet-move';

const PHRASE = 'test phrase not a real seed';

function memory(ls: Record<string, string> = {}, idb: Record<string, [IDBValidKey, unknown][]> = {}) {
	const keyOf = (k: IDBValidKey) => (k instanceof Uint8Array ? `b:${Array.from(k).join(',')}` : `s:${String(k)}`);
	const rows = new Map<string, Map<string, [IDBValidKey, unknown]>>();
	for (const [where, entries] of Object.entries(idb)) {
		rows.set(where, new Map(entries.map((e) => [keyOf(e[0]), e])));
	}
	const local = { ...ls };
	const s: MoveStorage & { local(): Record<string, string>; rows: typeof rows } = {
		rows,
		async dump(db, store) {
			return [...(rows.get(`${db}/${store}`)?.values() ?? [])];
		},
		async write(db, store, entries) {
			const m = rows.get(`${db}/${store}`) ?? new Map();
			for (const [k, v] of entries) m.set(keyOf(k), [k, v]);
			rows.set(`${db}/${store}`, m);
		},
		local: () => ({ ...local }),
		setLocal: (k, v) => {
			local[k] = v;
		}
	};
	return s;
}

const NODE_DB = 'extro-node-dev';
const legacyIdb = () => ({
	'weby-wallet-v2-production/wallet_state': [['wallet', '{"outputs":[1]}']] as [IDBValidKey, unknown][],
	'weby-ark-contract-journal-v1/contracts': [['c1', '{"vhtlc":"x"}']] as [IDBValidKey, unknown][],
	[`${NODE_DB}/kv`]: [[new Uint8Array([1, 2]), new Uint8Array([0, 255, 7])]] as [IDBValidKey, unknown][]
});
const plainLs = {
	weby_wallet_exists: 'true',
	weby_license_accepted: 'true',
	'weby-wallet-mnemonic': PHRASE,
	weby_mining_snapshot: '{}',
	unrelated: 'x'
};

describe('wallet move bundle', () => {
	it('round-trips an unencrypted wallet exactly (strings and bytes), flag last, ephemera dropped', async () => {
		const legacy = memory(plainLs, legacyIdb());
		const payload = await exportMoveBundle(legacy, { from: 'https://dev.weby.cash', nodeDbName: NODE_DB, now: 1 });
		const bundle = parseMoveBundle(payload);
		expect(bundle.protection).toBe('none');
		expect(Object.keys(bundle.ls).sort()).toEqual(['weby-wallet-mnemonic', 'weby_license_accepted', 'weby_wallet_exists']);

		const home = memory();
		const writes: string[] = [];
		const setLocal = home.setLocal;
		home.setLocal = (k, v) => {
			writes.push(k);
			setLocal(k, v);
		};
		const summary = await importMoveBundle(home, bundle, { nodeDbName: NODE_DB });
		expect(summary).toEqual({ from: 'https://dev.weby.cash', protection: 'none', walletEntries: 1, contracts: 1, nodeEntries: 1 });
		expect(writes.at(-1)).toBe('weby_wallet_exists');
		expect(home.local()['weby-wallet-mnemonic']).toBe(PHRASE);
		expect(home.local().weby_mining_snapshot).toBeUndefined();
		const [[k, v]] = await home.dump(NODE_DB, 'kv');
		expect(k).toEqual(new Uint8Array([1, 2]));
		expect(v).toEqual(new Uint8Array([0, 255, 7]));
		expect(await home.dump(...storeLocation('ark-journal', NODE_DB))).toEqual([['c1', '{"vhtlc":"x"}']]);
		// the legacy origin keeps everything (nothing is deleted)
		expect(legacy.local()['weby-wallet-mnemonic']).toBe(PHRASE);
	});

	it('maps the node store to each side’s own db_name', async () => {
		const legacy = memory(plainLs, legacyIdb());
		const bundle = parseMoveBundle(await exportMoveBundle(legacy, { from: 'o', nodeDbName: NODE_DB }));
		const home = memory();
		await importMoveBundle(home, bundle, { nodeDbName: 'extro-node-other' });
		expect((await home.dump('extro-node-other', 'kv')).length).toBe(1);
	});

	it('a password wallet moves still encrypted (no plaintext phrase in the bundle)', async () => {
		const legacy = memory(
			{ ...plainLs, weby_encryption_type: 'password', weby_encrypted_wallet: '{"ct":"…"}' },
			legacyIdb()
		);
		const payload = await exportMoveBundle(legacy, { from: 'o', nodeDbName: NODE_DB });
		expect(payload).not.toContain(PHRASE);
		const b = parseMoveBundle(payload);
		expect(b.protection).toBe('password');
		const home = memory();
		await importMoveBundle(home, b, { nodeDbName: NODE_DB });
		expect(home.local().weby_encrypted_wallet).toBe('{"ct":"…"}');
		expect(home.local()['weby-wallet-mnemonic']).toBeUndefined();
	});

	it('a passkey wallet (origin-bound) must be unlocked and arrives flagged to protect again', async () => {
		const locked = memory(
			{ weby_wallet_exists: 'true', weby_encryption_type: 'passkey', weby_encrypted_wallet: 'v', weby_passkey_credential: 'c' },
			legacyIdb()
		);
		await expect(exportMoveBundle(locked, { from: 'o', nodeDbName: NODE_DB })).rejects.toMatchObject({ code: 'locked' });
		const unlocked = memory(
			{ ...plainLs, weby_encryption_type: 'passkey', weby_encrypted_wallet: 'v', weby_passkey_credential: 'c' },
			legacyIdb()
		);
		const b = parseMoveBundle(await exportMoveBundle(unlocked, { from: 'o', nodeDbName: NODE_DB }));
		expect(b.protection).toBe('reprotect');
		expect(Object.keys(b.ls)).not.toContain('weby_passkey_credential');
		const home = memory();
		await importMoveBundle(home, b, { nodeDbName: NODE_DB });
		expect(home.local()[REPROTECT_KEY]).toBe('true');
	});

	it('refuses: no wallet, a non-empty home, values it cannot carry exactly', async () => {
		await expect(exportMoveBundle(memory({}), { from: 'o', nodeDbName: NODE_DB })).rejects.toMatchObject({ code: 'no_wallet' });
		const b = parseMoveBundle(await exportMoveBundle(memory(plainLs, legacyIdb()), { from: 'o', nodeDbName: NODE_DB }));
		const full = memory({ 'weby-wallet-mnemonic': 'other' });
		expect(homeIsEmpty(full)).toBe(false);
		await expect(importMoveBundle(full, b, { nodeDbName: NODE_DB })).rejects.toMatchObject({ code: 'home_not_empty' });
		const odd = memory(plainLs, { 'weby-ark-contract-journal-v1/contracts': [['c', { obj: 1 }]] });
		await expect(exportMoveBundle(odd, { from: 'o', nodeDbName: NODE_DB })).rejects.toBeInstanceOf(WalletMoveError);
	});

	it('detects a store that did not keep what was written', async () => {
		const b = parseMoveBundle(await exportMoveBundle(memory(plainLs, legacyIdb()), { from: 'o', nodeDbName: NODE_DB }));
		const home = memory();
		home.write = async () => {};
		await expect(importMoveBundle(home, b, { nodeDbName: NODE_DB })).rejects.toMatchObject({ code: 'readback_mismatch' });
		expect(home.local().weby_wallet_exists).toBeUndefined();
	});

	it('parse is strict', async () => {
		const good = JSON.parse(await exportMoveBundle(memory(plainLs, legacyIdb()), { from: 'o', nodeDbName: NODE_DB }));
		const bad = (f: (b: typeof good) => void) => {
			const c = structuredClone(good);
			f(c);
			return () => parseMoveBundle(JSON.stringify(c));
		};
		expect(() => parseMoveBundle('nope')).toThrow(WalletMoveError);
		expect(bad((b) => (b.version = 2))).toThrow(WalletMoveError);
		expect(bad((b) => (b.ls.evil = 'x'))).toThrow(WalletMoveError);
		expect(bad((b) => (b.ls[MOVED_TO_KEY] = 'x'))).toThrow(WalletMoveError);
		expect(bad((b) => (b.protection = 'password'))).toThrow(WalletMoveError);
		expect(bad((b) => delete b.stores['ark-journal'])).toThrow(WalletMoveError);
		expect(bad((b) => (b.stores['extro-node'] = [[{ b: 'zz' }, { s: '' }]]))).toThrow(WalletMoveError);
		expect(bad((b) => (b.stores['extro-node'] = [[{ s: 'k', b: '00' }, { s: '' }]]))).toThrow(WalletMoveError);
	});
});
