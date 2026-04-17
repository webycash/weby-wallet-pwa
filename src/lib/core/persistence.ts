// IndexedDB persistence for BrowserWallet state.
// One database per network, one key-value store with the wallet state JSON.
// Master mnemonic is shared via localStorage across networks.

const DB_VERSION = 1;
const STORE = 'wallet_state';
const STATE_KEY = 'current';
const MNEMONIC_KEY = 'weby-wallet-mnemonic';

const dbName = (network: string) => `weby-wallet-${network}`;

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

export const loadState = async (network: string): Promise<string | null> => {
	const db = await openDb(network);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const store = tx.objectStore(STORE);
		const req = store.get(STATE_KEY);
		tx.oncomplete = () => resolve(req.result ?? null);
		tx.onerror = () => reject(tx.error);
	});
};

export const saveState = async (network: string, stateJson: string): Promise<void> => {
	const db = await openDb(network);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		store.put(stateJson, STATE_KEY);
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

// Mnemonic is shared across networks via localStorage.
export const getMnemonic = (): string | null => localStorage.getItem(MNEMONIC_KEY);
export const setMnemonic = (mnemonic: string) => localStorage.setItem(MNEMONIC_KEY, mnemonic);
export const clearMnemonic = () => localStorage.removeItem(MNEMONIC_KEY);
