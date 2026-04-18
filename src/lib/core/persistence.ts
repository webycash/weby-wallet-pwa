// Persistence — encrypted master wallet state in IndexedDB.
//
// One database per network. State is stored as a single JSON string.
// When encryption is enabled, the stored value is the encrypted blob;
// the app decrypts on load and re-encrypts before saving.
// Mnemonic is NEVER stored in localStorage when encryption is active —
// it lives only inside the encrypted state.

const DB_VERSION = 1;
const STORE = 'wallet_state';
const STATE_KEY = 'current';
const MNEMONIC_KEY = 'weby-wallet-mnemonic';
const ENCRYPTED_KEY = 'weby_encrypted_wallet';

const dbName = (network: string) => `weby-wallet-v2-${network}`;

const openDb = (network: string): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const req = indexedDB.open(dbName(network), DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

// ── State persistence (plaintext JSON in IDB) ──────────────────

export const loadState = async (network: string, key: string = STATE_KEY): Promise<string | null> => {
	try {
		const db = await openDb(network);
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readonly');
			const store = tx.objectStore(STORE);
			const req = store.get(key);
			tx.oncomplete = () => resolve(req.result ?? null);
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		return null;
	}
};

export const saveState = async (network: string, stateJson: string, key: string = STATE_KEY): Promise<void> => {
	const db = await openDb(network);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		store.put(stateJson, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
};

export const deleteKey = async (network: string, key: string): Promise<void> => {
	const db = await openDb(network);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		store.delete(key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
};

export const clearState = async (network: string): Promise<void> => {
	return new Promise((resolve, reject) => {
		const req = indexedDB.deleteDatabase(dbName(network));
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
		req.onblocked = () => resolve();
	});
};

export const hasState = async (network: string): Promise<boolean> => {
	const state = await loadState(network);
	return state !== null;
};

// ── Wallet registry (localStorage, per network) ─────────────────
// Each entry: {family, label, index} — index maps to keychain slot.

const REGISTRY_KEY = (network: string) => `weby_wallet_registry_${network}`;
const ACTIVE_KEY = (network: string) => `weby_wallet_active_${network}`;

export interface WalletEntry { family: string; label: string; index: number }

export const getRegistry = (network: string): WalletEntry[] => {
	const raw = localStorage.getItem(REGISTRY_KEY(network));
	if (!raw) return [{ family: 'webcash', label: 'main', index: 0 }];
	return JSON.parse(raw);
};

export const setRegistry = (network: string, entries: WalletEntry[]) => {
	localStorage.setItem(REGISTRY_KEY(network), JSON.stringify(entries));
};

export const getActive = (network: string): { family: string; label: string } => {
	const raw = localStorage.getItem(ACTIVE_KEY(network));
	if (!raw) return { family: 'webcash', label: 'main' };
	return JSON.parse(raw);
};

export const setActive = (network: string, family: string, label: string) => {
	localStorage.setItem(ACTIVE_KEY(network), JSON.stringify({ family, label }));
};

export const walletStateKey = (family: string, label: string): string =>
	`wallet:${family}:${label}`;

// ── Mnemonic (localStorage, shared across networks) ─────────────

export const getMnemonic = (): string | null => localStorage.getItem(MNEMONIC_KEY);
export const setMnemonic = (mnemonic: string) => localStorage.setItem(MNEMONIC_KEY, mnemonic);
export const clearMnemonic = () => localStorage.removeItem(MNEMONIC_KEY);

// ── Encrypted state (localStorage — survives IDB clear) ─────────

export const getEncryptedState = (): string | null => localStorage.getItem(ENCRYPTED_KEY);
export const setEncryptedState = (blob: string) => localStorage.setItem(ENCRYPTED_KEY, blob);
export const clearEncryptedState = () => localStorage.removeItem(ENCRYPTED_KEY);

// ── Full reset ──────────────────────────────────────────────────

export const deleteEverything = async (): Promise<void> => {
	await clearState('production');
	await clearState('testnet');
	// Also clear legacy v1 databases
	await new Promise<void>((resolve) => {
		const r = indexedDB.deleteDatabase('weby-wallet-production');
		r.onsuccess = () => resolve(); r.onerror = () => resolve();
	});
	await new Promise<void>((resolve) => {
		const r = indexedDB.deleteDatabase('weby-wallet-testnet');
		r.onsuccess = () => resolve(); r.onerror = () => resolve();
	});
	clearMnemonic();
	clearEncryptedState();
	const keysToRemove = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key?.startsWith('weby_')) keysToRemove.push(key);
	}
	for (const key of keysToRemove) localStorage.removeItem(key);
};
