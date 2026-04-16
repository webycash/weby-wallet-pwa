// IndexedDB storage layer — all I/O contained here.
// Schema matches webylib's SQLite tables exactly.

import type { StoredOutput, StoredSpentHash, WalletSnapshot } from './types';

const DB_NAME = 'weby-wallet';
const DB_VERSION = 1;

// ── Open / Upgrade ───────────────────────────────────────────────

export const openDb = (): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('wallet_metadata')) {
				db.createObjectStore('wallet_metadata', { keyPath: 'key' });
			}
			if (!db.objectStoreNames.contains('unspent_outputs')) {
				const store = db.createObjectStore('unspent_outputs', { keyPath: 'id', autoIncrement: true });
				store.createIndex('secretHash', 'secretHash', { unique: true });
				store.createIndex('spent', 'spent', { unique: false });
			}
			if (!db.objectStoreNames.contains('spent_hashes')) {
				const store = db.createObjectStore('spent_hashes', { keyPath: 'id', autoIncrement: true });
				store.createIndex('hash', 'hash', { unique: true });
			}
			if (!db.objectStoreNames.contains('walletdepths')) {
				db.createObjectStore('walletdepths', { keyPath: 'chainCode' });
			}
		};
	});

// ── Helpers ──────────────────────────────────────────────────────

const tx = (db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode = 'readonly') =>
	db.transaction(stores, mode);

const req = <T>(r: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});

const all = <T>(r: IDBRequest<T[]>): Promise<T[]> => req(r);

// ── Metadata ─────────────────────────────────────────────────────

export const getMeta = (db: IDBDatabase, key: string): Promise<string | undefined> =>
	req(tx(db, 'wallet_metadata').objectStore('wallet_metadata').get(key))
		.then(r => r?.value);

export const setMeta = (db: IDBDatabase, key: string, value: string): Promise<void> =>
	req(tx(db, 'wallet_metadata', 'readwrite').objectStore('wallet_metadata').put({ key, value }))
		.then(() => {});

// ── Depths ───────────────────────────────────────────────────────

export const getDepth = (db: IDBDatabase, chainCode: string): Promise<number> =>
	req(tx(db, 'walletdepths').objectStore('walletdepths').get(chainCode))
		.then(r => r?.depth ?? 0);

export const setDepth = (db: IDBDatabase, chainCode: string, depth: number): Promise<void> =>
	req(tx(db, 'walletdepths', 'readwrite').objectStore('walletdepths').put({ chainCode, depth }))
		.then(() => {});

// ── Outputs ──────────────────────────────────────────────────────

export const getUnspent = (db: IDBDatabase): Promise<StoredOutput[]> => {
	const t = tx(db, 'unspent_outputs');
	const idx = t.objectStore('unspent_outputs').index('spent');
	return all(idx.getAll(0));
};

export const getAllOutputs = (db: IDBDatabase): Promise<StoredOutput[]> =>
	all(tx(db, 'unspent_outputs').objectStore('unspent_outputs').getAll());

export const putOutput = (db: IDBDatabase, output: StoredOutput): Promise<void> =>
	req(tx(db, 'unspent_outputs', 'readwrite').objectStore('unspent_outputs').add(output))
		.then(() => {});

export const markSpent = async (db: IDBDatabase, secretHash: ArrayBuffer): Promise<void> => {
	const t = tx(db, 'unspent_outputs', 'readwrite');
	const store = t.objectStore('unspent_outputs');
	const idx = store.index('secretHash');
	const record = await req(idx.get(secretHash));
	if (record) {
		record.spent = 1;
		await req(store.put(record));
	}
};

// ── Spent Hashes ─────────────────────────────────────────────────

export const addSpentHash = (db: IDBDatabase, hash: ArrayBuffer, spentAt: string): Promise<void> =>
	req(tx(db, 'spent_hashes', 'readwrite').objectStore('spent_hashes').add({ hash, spentAt } as StoredSpentHash))
		.then(() => {});

export const getSpentHashes = (db: IDBDatabase): Promise<StoredSpentHash[]> =>
	all(tx(db, 'spent_hashes').objectStore('spent_hashes').getAll());

// ── Bulk Import / Export ─────────────────────────────────────────

export const clearAll = async (db: IDBDatabase): Promise<void> => {
	const t = tx(db, ['wallet_metadata', 'unspent_outputs', 'spent_hashes', 'walletdepths'], 'readwrite');
	t.objectStore('wallet_metadata').clear();
	t.objectStore('unspent_outputs').clear();
	t.objectStore('spent_hashes').clear();
	t.objectStore('walletdepths').clear();
	await new Promise<void>((resolve, reject) => {
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
	});
};

export const hasWallet = async (db: IDBDatabase): Promise<boolean> => {
	const ms = await getMeta(db, 'master_secret');
	return ms !== undefined && ms.length === 64;
};

export const exportSnapshot = async (db: IDBDatabase, sha256Fn: (data: string) => Promise<string>): Promise<WalletSnapshot> => {
	const masterSecret = await getMeta(db, 'master_secret') ?? '';
	const outputs = await getUnspent(db);
	const spentHashes = await getSpentHashes(db);

	const depths: Record<string, number> = {};
	for (const code of ['RECEIVE', 'PAY', 'CHANGE', 'MINING']) {
		depths[code] = await getDepth(db, code);
	}

	return {
		master_secret: masterSecret,
		unspent_outputs: outputs.map(o => ({
			secret: o.secret,
			amount: o.amount,
			created_at: o.createdAt
		})),
		spent_hashes: await Promise.all(spentHashes.map(async s => ({
			hash: Array.from(new Uint8Array(s.hash), b => b.toString(16).padStart(2, '0')).join(''),
			spent_at: s.spentAt
		}))),
		depths
	};
};

export const importSnapshot = async (
	db: IDBDatabase,
	snapshot: WalletSnapshot,
	sha256Fn: (data: string) => Promise<string>
): Promise<void> => {
	await clearAll(db);
	await setMeta(db, 'master_secret', snapshot.master_secret);

	for (const [code, depth] of Object.entries(snapshot.depths)) {
		await setDepth(db, code, depth);
	}

	for (const item of snapshot.unspent_outputs) {
		const hashHex = await sha256Fn(item.secret);
		const hashBytes = new Uint8Array(hashHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
		await putOutput(db, {
			secretHash: hashBytes.buffer,
			secret: item.secret,
			amount: item.amount,
			createdAt: item.created_at,
			spent: 0
		});
	}

	for (const item of snapshot.spent_hashes) {
		const hashBytes = new Uint8Array(item.hash.match(/.{2}/g)!.map(b => parseInt(b, 16)));
		await addSpentHash(db, hashBytes.buffer, item.spent_at);
	}
};
