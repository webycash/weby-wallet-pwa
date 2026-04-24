// Full-state migration — used to move a wallet from the Safari browser
// context into the installed iOS PWA (which has a separate storage partition).
//
// The bundle is plain JSON (base64-encoded) containing every weby_* localStorage
// key and every IDB wallet_state entry across both networks. Transport is the
// system clipboard on iOS; the window between export and import is expected to
// be seconds long.

import * as Persistence from './persistence';

const BUNDLE_VERSION = 1;
const BUNDLE_PREFIX = 'weby-migrate:v1:';

export interface MigrationBundle {
	version: number;
	created_at: number;
	ls: Record<string, string>;
	idb: {
		production: Record<string, string>;
		testnet: Record<string, string>;
	};
}

const dbName = (network: string) => `weby-wallet-v2-${network}`;

const dumpIdb = async (network: string): Promise<Record<string, string>> => {
	return new Promise((resolve) => {
		const req = indexedDB.open(dbName(network));
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('wallet_state')) {
				db.createObjectStore('wallet_state');
			}
		};
		req.onsuccess = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('wallet_state')) {
				resolve({});
				return;
			}
			const tx = db.transaction('wallet_state', 'readonly');
			const store = tx.objectStore('wallet_state');
			const out: Record<string, string> = {};
			const cur = store.openCursor();
			cur.onsuccess = () => {
				const c = cur.result;
				if (c) {
					if (typeof c.value === 'string') out[String(c.key)] = c.value;
					c.continue();
				} else {
					resolve(out);
				}
			};
			cur.onerror = () => resolve(out);
		};
		req.onerror = () => resolve({});
	});
};

const restoreIdb = async (network: string, entries: Record<string, string>): Promise<void> => {
	if (!entries || Object.keys(entries).length === 0) return;
	for (const [key, value] of Object.entries(entries)) {
		await Persistence.saveState(network, value, key);
	}
};

// Collect every localStorage key we wrote (prefix weby_) plus the raw mnemonic key.
const dumpLocalStorage = (): Record<string, string> => {
	const out: Record<string, string> = {};
	if (typeof localStorage === 'undefined') return out;
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (!k) continue;
		if (k.startsWith('weby_') || k === 'weby-wallet-mnemonic') {
			const v = localStorage.getItem(k);
			if (v !== null) out[k] = v;
		}
	}
	return out;
};

export const exportMigrationBundle = async (): Promise<string> => {
	const bundle: MigrationBundle = {
		version: BUNDLE_VERSION,
		created_at: Date.now(),
		ls: dumpLocalStorage(),
		idb: {
			production: await dumpIdb('production'),
			testnet: await dumpIdb('testnet'),
		},
	};
	// Exclude ephemeral / transient state that should not cross devices
	delete bundle.ls['weby_mining_snapshot'];
	delete bundle.ls['weby_install_done'];

	const json = JSON.stringify(bundle);
	// Base64 encode (UTF-8 safe)
	const utf8 = new TextEncoder().encode(json);
	let binary = '';
	for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
	return BUNDLE_PREFIX + btoa(binary);
};

export const parseMigrationBundle = (raw: string): MigrationBundle | null => {
	try {
		const trimmed = raw.trim();
		if (!trimmed.startsWith(BUNDLE_PREFIX)) return null;
		const b64 = trimmed.slice(BUNDLE_PREFIX.length);
		const binary = atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		const json = new TextDecoder().decode(bytes);
		const parsed = JSON.parse(json) as MigrationBundle;
		if (parsed.version !== BUNDLE_VERSION) return null;
		if (!parsed.ls || !parsed.idb) return null;
		return parsed;
	} catch {
		return null;
	}
};

export const importMigrationBundle = async (bundle: MigrationBundle): Promise<void> => {
	for (const [k, v] of Object.entries(bundle.ls)) {
		try { localStorage.setItem(k, v); } catch { /* quota — skip */ }
	}
	await restoreIdb('production', bundle.idb.production ?? {});
	await restoreIdb('testnet', bundle.idb.testnet ?? {});
};

// Best-effort clipboard wipe after import so the bundle doesn't linger.
export const clearClipboard = async (): Promise<void> => {
	try { await navigator.clipboard.writeText(''); } catch { /* ignore */ }
};

export const readClipboardBundle = async (): Promise<MigrationBundle | null> => {
	try {
		const text = await navigator.clipboard.readText();
		return parseMigrationBundle(text);
	} catch {
		return null;
	}
};

export const isMigrationInstalled = (): boolean => {
	if (typeof localStorage === 'undefined') return false;
	// A successful migration always brings the mnemonic + the wallet_exists flag.
	return localStorage.getItem('weby_wallet_exists') === 'true';
};
