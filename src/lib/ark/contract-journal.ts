/**
 * Durable swap-contract journal (recoverability gate).
 *
 * Every 2-of-2 swap contract is reconstructible only from the exact signed
 * prepare terms (+ the referee-signed prepared response): idempotency key,
 * nonce, expiry and provider MuSig2 nonces are all chosen per swap. The
 * referee keeps no durable copy (its container store is ephemeral), so the
 * wallet MUST persist those bytes to durable storage and read them back
 * BEFORE any sats move into the contract. `fundArkSwapContractPersisted`
 * refuses to fund otherwise.
 *
 * Contents are public protocol material (signed terms, referee response,
 * contract address/tapscripts) — no keys, nonce secrets or mnemonic.
 */

import { fundArkSwapContract, type ArkFundingWallet, type ArkSwapContract } from './swap-contract';

export const CONTRACT_JOURNAL_VERSION = 1;

export type ContractJournalRecord = {
	v: typeof CONTRACT_JOURNAL_VERSION;
	role: 'provider' | 'bearer-seller';
	swapId: string;
	orderIdHex: string;
	network: string;
	refereeUrl: string;
	refereeVkHex: string;
	contractAddress: string;
	arkAmountSats: string;
	tapTreeHex: string;
	/** Commitment over the canonical prepare terms (hex). */
	requestCommitmentHex: string;
	/** Both party signatures over the terms + the referee-signed response (hex). */
	providerSignedHex: string;
	bearerSellerSignedHex: string;
	refereeSignedResponseHex: string;
	createdAtUnix: number;
	/** Set after funding succeeds. */
	fundingArkTxId?: string;
};

/** Minimal durable KV; production = IndexedDB, tests = in-memory. */
export interface ContractJournalBackend {
	put(key: string, value: string): Promise<void>;
	get(key: string): Promise<string | null>;
	keys(): Promise<string[]>;
	/** Ask the browser to make storage persistent (best-effort signal). */
	requestPersistence?(): Promise<boolean>;
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const bytesHex = toHex;

const keyFor = (swapId: string) => `contract:${swapId}`;

const canonical = (r: ContractJournalRecord): string =>
	JSON.stringify(r, Object.keys(r).sort());

export class ContractNotPersistedError extends Error {
	readonly gate = 'ARK_CONTRACT_NOT_PERSISTED';
	constructor(detail: string) {
		super(`ARK_CONTRACT_NOT_PERSISTED: ${detail}`);
	}
}

function validate(r: ContractJournalRecord): void {
	const need: (keyof ContractJournalRecord)[] = [
		'swapId',
		'contractAddress',
		'arkAmountSats',
		'requestCommitmentHex',
		'providerSignedHex',
		'bearerSellerSignedHex',
		'refereeSignedResponseHex',
		'refereeVkHex'
	];
	for (const k of need) {
		const v = r[k];
		if (typeof v !== 'string' || v.length === 0) throw new ContractNotPersistedError(`record missing ${k}`);
	}
}

/** Write, then read back and compare byte-for-byte. Throws on any mismatch. */
export async function persistContractRecord(
	backend: ContractJournalBackend,
	record: ContractJournalRecord
): Promise<void> {
	validate(record);
	const body = canonical(record);
	try {
		await backend.put(keyFor(record.swapId), body);
	} catch (e) {
		throw new ContractNotPersistedError(`write failed: ${(e as Error).message}`);
	}
	let back: string | null;
	try {
		back = await backend.get(keyFor(record.swapId));
	} catch (e) {
		throw new ContractNotPersistedError(`read-back failed: ${(e as Error).message}`);
	}
	if (back !== body) throw new ContractNotPersistedError('read-back mismatch');
	try {
		await backend.requestPersistence?.();
	} catch {
		/* persistence request is advisory */
	}
}

export async function loadContractRecord(
	backend: ContractJournalBackend,
	swapId: string
): Promise<ContractJournalRecord | null> {
	const raw = await backend.get(keyFor(swapId));
	return raw ? (JSON.parse(raw) as ContractJournalRecord) : null;
}

export async function listContractRecords(backend: ContractJournalBackend): Promise<ContractJournalRecord[]> {
	const out: ContractJournalRecord[] = [];
	for (const k of await backend.keys()) {
		if (!k.startsWith('contract:')) continue;
		const raw = await backend.get(k);
		if (raw) out.push(JSON.parse(raw) as ContractJournalRecord);
	}
	return out;
}

/** Assert the journal holds exactly this contract (same address + amount + terms). */
export async function assertContractPersisted(
	backend: ContractJournalBackend,
	contract: Pick<ArkSwapContract, 'address' | 'plan'>,
	requestCommitmentHex: string
): Promise<ContractJournalRecord> {
	let rec: ContractJournalRecord | null;
	try {
		rec = await loadContractRecord(backend, contract.plan.swapId);
	} catch (e) {
		throw new ContractNotPersistedError(`journal unreadable: ${(e as Error).message}`);
	}
	if (!rec) throw new ContractNotPersistedError(`no journal record for swap ${contract.plan.swapId}`);
	validate(rec);
	if (rec.contractAddress !== contract.address) throw new ContractNotPersistedError('journal address mismatch');
	if (rec.arkAmountSats !== contract.plan.amountSats.toString()) {
		throw new ContractNotPersistedError('journal amount mismatch');
	}
	if (rec.requestCommitmentHex.toLowerCase() !== requestCommitmentHex.toLowerCase()) {
		throw new ContractNotPersistedError('journal terms commitment mismatch');
	}
	return rec;
}

/**
 * The ONLY funding entry point for swap contracts: refuses unless the signed
 * terms for this exact contract are durably persisted (read back verified).
 */
export async function fundArkSwapContractPersisted(
	backend: ContractJournalBackend,
	wallet: ArkFundingWallet,
	contract: ArkSwapContract,
	requestCommitmentHex: string
): Promise<{ arkTxId: string; amountSats: bigint; address: string }> {
	const rec = await assertContractPersisted(backend, contract, requestCommitmentHex);
	const funded = await fundArkSwapContract(wallet, contract);
	try {
		await persistContractRecord(backend, { ...rec, fundingArkTxId: funded.arkTxId });
	} catch {
		/* funding txid is a convenience; terms were already durable */
	}
	return funded;
}

// ── IndexedDB backend ─────────────────────────────────────────────

const DB_NAME = 'weby-ark-contract-journal-v1';
const STORE = 'contracts';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB unavailable'));
			return;
		}
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const t = db.transaction(STORE, mode, { durability: 'strict' } as IDBTransactionOptions);
				const req = run(t.objectStore(STORE));
				t.oncomplete = () => {
					db.close();
					resolve(req.result);
				};
				t.onerror = () => {
					db.close();
					reject(t.error);
				};
				t.onabort = () => {
					db.close();
					reject(t.error ?? new Error('IndexedDB transaction aborted'));
				};
			})
	);
}

export const idbContractJournal: ContractJournalBackend = {
	put: (key, value) => tx('readwrite', (s) => s.put(value, key)).then(() => undefined),
	get: (key) => tx('readonly', (s) => s.get(key) as IDBRequest<string | undefined>).then((v) => v ?? null),
	keys: () => tx('readonly', (s) => s.getAllKeys()).then((ks) => ks.map(String)),
	requestPersistence: async () => {
		const nav = typeof navigator !== 'undefined' ? navigator : undefined;
		if (!nav?.storage?.persist) return false;
		return (await nav.storage.persisted?.()) || nav.storage.persist();
	}
};

export function memoryContractJournal(): ContractJournalBackend & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return {
		map,
		put: async (k, v) => void map.set(k, v),
		get: async (k) => map.get(k) ?? null,
		keys: async () => [...map.keys()]
	};
}
