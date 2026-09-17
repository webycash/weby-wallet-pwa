// CapToken cross-domain wallet grant helpers (R1 PERMISSION) over existing
// extro-node WalletCommand::MintCapToken / RevokeCapToken.

import type { ExtroClient } from './client';
import { newRequestId } from './commands';
import {
	loadWalletRegistry,
	saveWalletRegistry,
	selectWallet,
	upsertWallet,
	type WalletRegistryState,
} from './wallet-registry';

export interface CapTokenGrant {
	token: Uint8Array;
	issuerVerifyingKey: Uint8Array;
	aud: string;
	scopes: string[];
	fingerprintHex: string;
	expUnix: number;
	sourceDomain: string;
	targetDomain: string;
}

const GRANT_DB = 'extro-captoken-grants-v1';
const GRANT_STORE = 'grants';

function openGrantDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(GRANT_DB, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(GRANT_STORE)) db.createObjectStore(GRANT_STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('grant idb open failed'));
	});
}

function grantKey(sourceDomain: string, targetDomain: string, fingerprintHex: string): string {
	return `${sourceDomain}|${targetDomain}|${fingerprintHex.toLowerCase()}`;
}

export async function persistGrant(grant: CapTokenGrant): Promise<void> {
	const db = await openGrantDb();
	const key = grantKey(grant.sourceDomain, grant.targetDomain, grant.fingerprintHex);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(GRANT_STORE, 'readwrite');
		tx.objectStore(GRANT_STORE).put(grant, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('grant put failed'));
	});
}

export async function loadGrant(
	sourceDomain: string,
	targetDomain: string,
	fingerprintHex: string,
): Promise<CapTokenGrant | null> {
	const db = await openGrantDb();
	const key = grantKey(sourceDomain, targetDomain, fingerprintHex);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(GRANT_STORE, 'readonly');
		const req = tx.objectStore(GRANT_STORE).get(key);
		req.onsuccess = () => resolve((req.result as CapTokenGrant) ?? null);
		req.onerror = () => reject(req.error ?? new Error('grant get failed'));
	});
}

export async function deleteGrant(
	sourceDomain: string,
	targetDomain: string,
	fingerprintHex: string,
): Promise<void> {
	const db = await openGrantDb();
	const key = grantKey(sourceDomain, targetDomain, fingerprintHex);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(GRANT_STORE, 'readwrite');
		tx.objectStore(GRANT_STORE).delete(key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('grant delete failed'));
	});
}

/** Hub: mint CapToken for a consumer origin and persist grant + registry. */
export async function mintCrossDomainGrant(
	hub: ExtroClient,
	opts: {
		slot?: number;
		aud: string;
		scopes: string[];
		ttlSecs: number;
		sourceDomain: string;
		targetDomain: string;
	},
): Promise<CapTokenGrant> {
	const res = await hub.send({
		request_id: newRequestId(),
		op: {
			kind: 'Wallet',
			cmd: {
				op: 'MintCapToken',
				slot: opts.slot ?? 0,
				aud: opts.aud,
				scopes: opts.scopes,
				ttl_secs: opts.ttlSecs,
			},
		},
	});
	if (res.kind !== 'Ok' || res.body.kind !== 'CapTokenIssued') {
		const detail =
			res.kind === 'Err' ? `${res.code}: ${res.message}` : `unexpected ${JSON.stringify(res)}`;
		throw new Error(`MintCapToken failed: ${detail}`);
	}
	const grant: CapTokenGrant = {
		token: res.body.token,
		issuerVerifyingKey: res.body.issuer_verifying_key,
		aud: res.body.aud,
		scopes: res.body.scopes,
		fingerprintHex: res.body.fingerprint_hex.toLowerCase(),
		expUnix: res.body.exp_unix,
		sourceDomain: opts.sourceDomain,
		targetDomain: opts.targetDomain,
	};
	await persistGrant(grant);
	let reg = await loadWalletRegistry();
	reg = upsertWallet(reg, {
		fingerprintHex: grant.fingerprintHex,
		sourceDomain: opts.sourceDomain,
		storageKind: 'Local',
	});
	const selected = selectWallet(reg, grant.fingerprintHex);
	if (selected) await saveWalletRegistry(selected);
	else await saveWalletRegistry(reg);
	return grant;
}

/** Hub: revoke CapToken and drop persisted grant. */
export async function revokeCrossDomainGrant(
	hub: ExtroClient,
	grant: CapTokenGrant,
): Promise<void> {
	const res = await hub.send({
		request_id: newRequestId(),
		op: {
			kind: 'Wallet',
			cmd: { op: 'RevokeCapToken', token: grant.token },
		},
	});
	if (res.kind !== 'Ok') {
		const detail = res.kind === 'Err' ? `${res.code}: ${res.message}` : JSON.stringify(res);
		throw new Error(`RevokeCapToken failed: ${detail}`);
	}
	await deleteGrant(grant.sourceDomain, grant.targetDomain, grant.fingerprintHex);
}

/** Consumer: record a received grant as CrossDomainGranted + select it. */
export async function acceptCrossDomainGrant(grant: CapTokenGrant): Promise<WalletRegistryState> {
	await persistGrant(grant);
	let reg = await loadWalletRegistry();
	reg = upsertWallet(reg, {
		fingerprintHex: grant.fingerprintHex,
		sourceDomain: grant.sourceDomain,
		storageKind: 'CrossDomainGranted',
	});
	const selected = selectWallet(reg, grant.fingerprintHex);
	if (!selected) throw new Error('acceptCrossDomainGrant: select failed');
	await saveWalletRegistry(selected);
	return selected;
}
