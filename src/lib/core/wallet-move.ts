// Wallet home move (ADR-0008 §12): the bundle a legacy wallet origin hands to
// the wallet home through @extro/node/wallet-migrate (a same-device popup
// postMessage; never the network, never the clipboard, never stored).
//
// Browser storage is per origin, so the bundle carries everything a wallet at
// this origin keeps, exactly:
//   - localStorage: every `weby_*` key and the recovery-phrase key
//   - IndexedDB: wallet state (both networks), the Ark swap-contract journal
//     (fund recovery material) and the extro-node store (db_name of each side)
// It fails closed on any value it cannot carry exactly, and the home imports
// only into an empty wallet (no merge), writing the "wallet exists" flag last.
//
// Protection: a password vault is origin-independent and moves as is (the
// recovery phrase stays encrypted; the user unlocks the home with the same
// password). A passkey is bound to this origin's hostname (WebAuthn rp.id), so
// a passkey wallet moves unlocked and the home asks the user to protect it again.

import * as Persistence from './persistence';

export const MOVE_FORMAT = 'weby-wallet-move';
export const MOVE_VERSION = 1;

const MNEMONIC_KEY = 'weby-wallet-mnemonic';
const ENCRYPTED_KEY = 'weby_encrypted_wallet';
const PASSKEY_KEY = 'weby_passkey_credential';
const ENCRYPTION_TYPE_KEY = 'weby_encryption_type';
const WALLET_EXISTS_KEY = 'weby_wallet_exists';
/** Set on the legacy origin after the home echoed the handoff digest. */
export const MOVED_TO_KEY = 'weby_moved_to';
/** Set on the home when an imported wallet must be protected again. */
export const REPROTECT_KEY = 'weby_move_reprotect';
/** Per-device / per-origin state that must not travel. */
const NOT_MOVED = new Set([
	'weby_mining_snapshot',
	'weby_install_done',
	'weby_backup_dismissed_session',
	MOVED_TO_KEY,
	REPROTECT_KEY
]);

/** The IndexedDB stores that hold wallet data (all at version 1). */
export type StoreId = 'wallet-production' | 'wallet-testnet' | 'ark-journal' | 'extro-node';
export const STORE_IDS: readonly StoreId[] = ['wallet-production', 'wallet-testnet', 'ark-journal', 'extro-node'];

/** `[db name, object store]` for a store on this origin. */
export function storeLocation(id: StoreId, nodeDbName: string): [string, string] {
	switch (id) {
		case 'wallet-production':
			return ['weby-wallet-v2-production', 'wallet_state']; // core/persistence.ts
		case 'wallet-testnet':
			return ['weby-wallet-v2-testnet', 'wallet_state'];
		case 'ark-journal':
			return ['weby-ark-contract-journal-v1', 'contracts']; // ark/contract-journal.ts
		case 'extro-node':
			return [nodeDbName, 'kv']; // extro-node src/storage/idb.rs
	}
}

/** A key or value, tagged so binary and text survive JSON exactly. */
export type Cell = { s: string } | { b: string };
export type Entry = [Cell, Cell];

export type Protection = 'none' | 'password' | 'reprotect';

export interface MoveBundle {
	format: typeof MOVE_FORMAT;
	version: typeof MOVE_VERSION;
	from: string;
	created_at: number;
	protection: Protection;
	ls: Record<string, string>;
	stores: Record<StoreId, Entry[]>;
}

export interface MoveSummary {
	from: string;
	protection: Protection;
	walletEntries: number;
	contracts: number;
	nodeEntries: number;
}

export class WalletMoveError extends Error {
	constructor(
		readonly code:
			| 'no_wallet'
			| 'locked'
			| 'home_not_empty'
			| 'malformed_bundle'
			| 'unsupported_value'
			| 'readback_mismatch',
		message: string
	) {
		super(message);
		this.name = 'WalletMoveError';
	}
}

/** Raw access to this origin's storage (IndexedDB + localStorage in the app; in-memory in tests). */
export interface MoveStorage {
	dump(db: string, store: string): Promise<[IDBValidKey, unknown][]>;
	write(db: string, store: string, entries: [IDBValidKey, unknown][]): Promise<void>;
	local(): Record<string, string>;
	setLocal(key: string, value: string): void;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => {
	if (!/^(?:[0-9a-f]{2})*$/.test(h)) throw new WalletMoveError('malformed_bundle', 'bad hex cell');
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
	return out;
};

export function encodeCell(v: unknown): Cell {
	if (typeof v === 'string') return { s: v };
	if (v instanceof Uint8Array) return { b: hex(v) };
	if (v instanceof ArrayBuffer) return { b: hex(new Uint8Array(v)) };
	throw new WalletMoveError('unsupported_value', `cannot carry a ${Object.prototype.toString.call(v)} exactly`);
}

export function decodeCell(c: unknown): string | Uint8Array {
	if (c && typeof c === 'object' && Object.keys(c).length === 1) {
		if (typeof (c as { s?: unknown }).s === 'string') return (c as { s: string }).s;
		if (typeof (c as { b?: unknown }).b === 'string') return unhex((c as { b: string }).b);
	}
	throw new WalletMoveError('malformed_bundle', 'bad cell');
}

const isMovedLocalKey = (k: string) => (k.startsWith('weby_') || k === MNEMONIC_KEY) && !NOT_MOVED.has(k);

/** Build the handoff payload on the legacy origin. The wallet must be unlocked unless it is password-protected. */
export async function exportMoveBundle(
	storage: MoveStorage,
	opts: { from: string; nodeDbName: string; now?: number }
): Promise<string> {
	const all = storage.local();
	if (all[WALLET_EXISTS_KEY] !== 'true') throw new WalletMoveError('no_wallet', 'no wallet on this origin');
	const ls: Record<string, string> = {};
	for (const [k, v] of Object.entries(all)) if (isMovedLocalKey(k)) ls[k] = v;

	const type = all[ENCRYPTION_TYPE_KEY] ?? 'none';
	let protection: Protection;
	if (type === 'password') {
		if (!ls[ENCRYPTED_KEY]) throw new WalletMoveError('locked', 'password vault missing');
		delete ls[MNEMONIC_KEY]; // stays inside the encrypted vault
		protection = 'password';
	} else if (type === 'passkey') {
		if (!ls[MNEMONIC_KEY]) throw new WalletMoveError('locked', 'unlock the wallet first');
		delete ls[ENCRYPTED_KEY];
		delete ls[PASSKEY_KEY];
		delete ls[ENCRYPTION_TYPE_KEY];
		protection = 'reprotect';
	} else {
		if (!ls[MNEMONIC_KEY]) throw new WalletMoveError('locked', 'no recovery phrase on this origin');
		protection = 'none';
	}

	const stores = {} as Record<StoreId, Entry[]>;
	for (const id of STORE_IDS) {
		const [db, store] = storeLocation(id, opts.nodeDbName);
		stores[id] = (await storage.dump(db, store)).map(([k, v]) => [encodeCell(k), encodeCell(v)] as Entry);
	}
	const bundle: MoveBundle = {
		format: MOVE_FORMAT,
		version: MOVE_VERSION,
		from: opts.from,
		created_at: opts.now ?? Date.now(),
		protection,
		ls,
		stores
	};
	return JSON.stringify(bundle);
}

/** Strict parse of a handoff payload (shape only; the digest is checked by @extro/node). */
export function parseMoveBundle(payload: string): MoveBundle {
	let b: MoveBundle;
	try {
		b = JSON.parse(payload) as MoveBundle;
	} catch {
		throw new WalletMoveError('malformed_bundle', 'not JSON');
	}
	const bad = (why: string) => new WalletMoveError('malformed_bundle', why);
	if (!b || b.format !== MOVE_FORMAT || b.version !== MOVE_VERSION) throw bad('unknown format');
	if (typeof b.from !== 'string' || typeof b.created_at !== 'number') throw bad('from / created_at');
	if (!['none', 'password', 'reprotect'].includes(b.protection)) throw bad('protection');
	if (!b.ls || typeof b.ls !== 'object') throw bad('ls');
	for (const [k, v] of Object.entries(b.ls)) {
		if (!isMovedLocalKey(k) || typeof v !== 'string') throw bad(`ls key ${k}`);
	}
	if (b.ls[WALLET_EXISTS_KEY] !== 'true') throw bad('no wallet in bundle');
	if (b.protection === 'password') {
		if (b.ls[ENCRYPTION_TYPE_KEY] !== 'password' || !b.ls[ENCRYPTED_KEY] || MNEMONIC_KEY in b.ls) throw bad('password vault');
	} else {
		if (!b.ls[MNEMONIC_KEY] || ENCRYPTED_KEY in b.ls || PASSKEY_KEY in b.ls) throw bad('unlocked wallet');
		if ((b.ls[ENCRYPTION_TYPE_KEY] ?? 'none') !== 'none') throw bad('encryption type');
	}
	if (!b.stores || typeof b.stores !== 'object' || Object.keys(b.stores).sort().join() !== [...STORE_IDS].sort().join()) {
		throw bad('stores');
	}
	for (const id of STORE_IDS) {
		if (!Array.isArray(b.stores[id])) throw bad(`store ${id}`);
		for (const e of b.stores[id]) {
			if (!Array.isArray(e) || e.length !== 2) throw bad(`entry in ${id}`);
			decodeCell(e[0]);
			decodeCell(e[1]);
		}
	}
	return b;
}

export const summarizeMove = (b: MoveBundle): MoveSummary => ({
	from: b.from,
	protection: b.protection,
	walletEntries: b.stores['wallet-production'].length + b.stores['wallet-testnet'].length,
	contracts: b.stores['ark-journal'].length,
	nodeEntries: b.stores['extro-node'].length
});

/** True when this origin holds no wallet (the only state the home imports into). */
export function homeIsEmpty(storage: MoveStorage): boolean {
	const ls = storage.local();
	return ls[WALLET_EXISTS_KEY] !== 'true' && !ls[MNEMONIC_KEY] && !ls[ENCRYPTED_KEY];
}

const cellKey = (c: Cell) => JSON.stringify(c);

/**
 * Import on the wallet home. Refuses a home that already has a wallet; writes
 * IndexedDB first, reads it back, then localStorage with the wallet flag last,
 * so an interrupted import never looks like a wallet and can simply be redone.
 */
export async function importMoveBundle(
	storage: MoveStorage,
	bundle: MoveBundle,
	opts: { nodeDbName: string }
): Promise<MoveSummary> {
	if (!homeIsEmpty(storage)) throw new WalletMoveError('home_not_empty', 'this origin already has a wallet');
	for (const id of STORE_IDS) {
		const [db, store] = storeLocation(id, opts.nodeDbName);
		const entries = bundle.stores[id].map(([k, v]) => [decodeCell(k), decodeCell(v)] as [IDBValidKey, unknown]);
		if (entries.length > 0) await storage.write(db, store, entries);
		const back = new Map((await storage.dump(db, store)).map(([k, v]) => [cellKey(encodeCell(k)), cellKey(encodeCell(v))]));
		for (const [k, v] of bundle.stores[id]) {
			if (back.get(cellKey(k)) !== cellKey(v)) throw new WalletMoveError('readback_mismatch', `${id} did not store exactly`);
		}
	}
	for (const [k, v] of Object.entries(bundle.ls)) if (k !== WALLET_EXISTS_KEY) storage.setLocal(k, v);
	if (bundle.protection === 'reprotect') storage.setLocal(REPROTECT_KEY, 'true');
	storage.setLocal(WALLET_EXISTS_KEY, 'true');
	return summarizeMove(bundle);
}

// ── Browser storage ──────────────────────────────────────────────────────────

function openStore(db: string, store: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		// Every wallet store is version 1 with one object store; create it as its owner would.
		const req = indexedDB.open(db, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => T): Promise<T> {
	return new Promise((resolve, reject) => {
		if (!db.objectStoreNames.contains(store)) {
			db.close();
			reject(new WalletMoveError('unsupported_value', `${db.name} has no ${store} store`));
			return;
		}
		const t = db.transaction(store, mode, { durability: 'strict' } as IDBTransactionOptions);
		const out = body(t.objectStore(store));
		t.oncomplete = () => {
			db.close();
			resolve(out);
		};
		t.onerror = t.onabort = () => {
			db.close();
			reject(t.error ?? new Error('IndexedDB transaction failed'));
		};
	});
}

export const browserMoveStorage: MoveStorage = {
	async dump(db, store) {
		const out: [IDBValidKey, unknown][] = [];
		await run(await openStore(db, store), store, 'readonly', (s) => {
			const cur = s.openCursor();
			cur.onsuccess = () => {
				const c = cur.result;
				if (!c) return;
				out.push([c.key, c.value]);
				c.continue();
			};
		});
		return out;
	},
	async write(db, store, entries) {
		await run(await openStore(db, store), store, 'readwrite', (s) => {
			for (const [k, v] of entries) s.put(v, k);
		});
	},
	local() {
		const out: Record<string, string> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			const v = k === null ? null : localStorage.getItem(k);
			if (k !== null && v !== null) out[k] = v;
		}
		return out;
	},
	setLocal: (k, v) => localStorage.setItem(k, v)
};

// ── Legacy-origin bookkeeping (never deletes anything) ───────────────────────

export interface MovedTo {
	home: string;
	at: number;
	digest_hex: string;
}

export function readMovedTo(): MovedTo | null {
	try {
		const raw = localStorage.getItem(MOVED_TO_KEY);
		return raw ? (JSON.parse(raw) as MovedTo) : null;
	} catch {
		return null;
	}
}

export const markMovedTo = (m: MovedTo) => localStorage.setItem(MOVED_TO_KEY, JSON.stringify(m));

/** After the handoff, an encrypted wallet goes back to its at-rest state here. */
export function relockAfterMove(encryptionType: string): void {
	if (encryptionType !== 'none') Persistence.clearMnemonic();
}
