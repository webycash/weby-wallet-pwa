// Local WalletRegistry (R2 SELECT) — mirrors extrolib::control::crossdomain::WalletRegistry.
// Persisted in IndexedDB; never leaves the device. Not signed.

export type WalletStorageKind = 'Local' | 'CrossDomainGranted';

export interface WalletEntry {
	fingerprintHex: string;
	sourceDomain: string;
	storageKind: WalletStorageKind;
}

export interface WalletRegistryState {
	wallets: WalletEntry[];
	selected: string | null;
}

const DB_NAME = 'extro-wallet-registry-v1';
const STORE = 'registry';
const KEY = 'default';

function empty(): WalletRegistryState {
	return { wallets: [], selected: null };
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('idb open failed'));
	});
}

export async function loadWalletRegistry(): Promise<WalletRegistryState> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).get(KEY);
		req.onsuccess = () => resolve((req.result as WalletRegistryState) ?? empty());
		req.onerror = () => reject(req.error ?? new Error('idb get failed'));
	});
}

export async function saveWalletRegistry(state: WalletRegistryState): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(state, KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('idb put failed'));
	});
}

export function upsertWallet(state: WalletRegistryState, entry: WalletEntry): WalletRegistryState {
	const wallets = state.wallets.filter((w) => w.fingerprintHex !== entry.fingerprintHex);
	wallets.push(entry);
	return { ...state, wallets };
}

/** Fail-closed: cannot select a fingerprint that is not registered. */
export function selectWallet(state: WalletRegistryState, fingerprintHex: string): WalletRegistryState | null {
	if (!state.wallets.some((w) => w.fingerprintHex === fingerprintHex)) return null;
	return { ...state, selected: fingerprintHex };
}

export function selectedEntry(state: WalletRegistryState): WalletEntry | null {
	if (!state.selected) return null;
	return state.wallets.find((w) => w.fingerprintHex === state.selected) ?? null;
}
