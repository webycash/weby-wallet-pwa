// Custody vault — password/passkey encrypted wallet material.
// `weby_encrypted_wallet` must never hold plaintext snapshots.

import {
	decryptJsonWithPasskey,
	decryptJsonWithPassword,
	encryptJsonWithPasskey,
	encryptJsonWithPassword
} from './encryption';
import type { WalletSnapshot } from './types';

export const ENCRYPTED_WALLET_KEY = 'weby_encrypted_wallet';
export const CUSTODY_VAULT_FORMAT = 'weby_custody_vault_v1' as const;

export class CustodyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CustodyError';
	}
}

export interface CustodyVaultV1 {
	format: typeof CUSTODY_VAULT_FORMAT;
	mnemonic: string;
	snapshot: WalletSnapshot;
}

let sessionPassword: string | null = null;

export const setSessionPassword = (password: string): void => {
	sessionPassword = password;
};

export const getSessionPassword = (): string | null => sessionPassword;

export const clearSessionSecrets = (): void => {
	sessionPassword = null;
};

/** Reject plaintext JSON mistakenly stored under `weby_encrypted_wallet`. */
export function assertEncryptedWalletBlob(raw: string): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CustodyError('weby_encrypted_wallet_invalid_json');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new CustodyError('weby_encrypted_wallet_not_object');
	}
	const obj = parsed as Record<string, unknown>;
	if ('ciphertext' in obj && Array.isArray(obj.ciphertext)) {
		return;
	}
	if ('master_secret' in obj || 'unspent_outputs' in obj || 'mnemonic' in obj) {
		throw new CustodyError('plaintext_under_weby_encrypted_wallet');
	}
	throw new CustodyError('weby_encrypted_wallet_missing_ciphertext');
}

export function isCustodyVault(value: unknown): value is CustodyVaultV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const obj = value as Record<string, unknown>;
	return (
		obj.format === CUSTODY_VAULT_FORMAT &&
		typeof obj.mnemonic === 'string' &&
		obj.mnemonic.length > 0 &&
		!!obj.snapshot &&
		typeof obj.snapshot === 'object'
	);
}

export function buildCustodyVault(mnemonic: string, snapshot: WalletSnapshot): CustodyVaultV1 {
	if (!mnemonic.trim()) throw new CustodyError('custody_vault_missing_mnemonic');
	if (!snapshot?.master_secret) throw new CustodyError('custody_vault_missing_snapshot');
	return { format: CUSTODY_VAULT_FORMAT, mnemonic, snapshot };
}

export async function encryptCustodyVaultWithPassword(
	vault: CustodyVaultV1,
	password: string
): Promise<string> {
	return encryptJsonWithPassword(vault, password);
}

export async function decryptCustodyVaultWithPassword(
	encrypted: string,
	password: string
): Promise<CustodyVaultV1> {
	assertEncryptedWalletBlob(encrypted);
	const payload = await decryptJsonWithPassword<unknown>(encrypted, password);
	return normalizeUnlockedPayload(payload);
}

export async function encryptCustodyVaultWithPasskey(
	vault: CustodyVaultV1
): Promise<{ encrypted: string; credentialId: string }> {
	return encryptJsonWithPasskey(vault);
}

export async function decryptCustodyVaultWithPasskey(encrypted: string): Promise<CustodyVaultV1> {
	assertEncryptedWalletBlob(encrypted);
	const payload = await decryptJsonWithPasskey<unknown>(encrypted);
	return normalizeUnlockedPayload(payload);
}

function normalizeUnlockedPayload(payload: unknown): CustodyVaultV1 {
	if (isCustodyVault(payload)) return payload;
	if (payload && typeof payload === 'object' && 'master_secret' in (payload as object)) {
		throw new CustodyError('legacy_snapshot_without_mnemonic_rejected');
	}
	throw new CustodyError('custody_vault_unrecognized_payload');
}
