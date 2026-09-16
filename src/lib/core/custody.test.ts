import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';

import {
	assertEncryptedWalletBlob,
	buildCustodyVault,
	CustodyError,
	decryptCustodyVaultWithPassword,
	encryptCustodyVaultWithPassword,
	isCustodyVault
} from './custody';
import type { WalletSnapshot } from './types';

// Vitest node environment — expose Web Crypto for AES-GCM tests.
if (!globalThis.crypto) {
	(globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
}

const snapshot = (): WalletSnapshot => ({
	master_secret: 'ab'.repeat(32),
	unspent_outputs: [],
	spent_hashes: [],
	depths: { RECEIVE: 0, PAY: 0, CHANGE: 0, MINING: 0 }
});

describe('P0 custody encryption', () => {
	it('rejects plaintext snapshots under weby_encrypted_wallet', () => {
		expect(() => assertEncryptedWalletBlob(JSON.stringify(snapshot()))).toThrowError(
			CustodyError
		);
		expect(() => assertEncryptedWalletBlob(JSON.stringify(snapshot()))).toThrow(
			/plaintext_under_weby_encrypted_wallet/
		);
	});

	it('rejects plaintext mnemonic objects under weby_encrypted_wallet', () => {
		expect(() =>
			assertEncryptedWalletBlob(JSON.stringify({ mnemonic: 'abandon art ...' }))
		).toThrow(/plaintext_under_weby_encrypted_wallet/);
	});

	it('round-trips a custody vault with password encryption', async () => {
		const vault = buildCustodyVault(
			'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
			snapshot()
		);
		expect(isCustodyVault(vault)).toBe(true);
		const encrypted = await encryptCustodyVaultWithPassword(vault, 'correct-horse-battery');
		assertEncryptedWalletBlob(encrypted);
		expect(encrypted).not.toContain('master_secret');
		expect(encrypted).not.toContain('abandon abandon');
		const unlocked = await decryptCustodyVaultWithPassword(encrypted, 'correct-horse-battery');
		expect(unlocked.mnemonic).toContain('abandon');
		expect(unlocked.snapshot.master_secret).toBe(snapshot().master_secret);
	});

	it('fails closed on wrong password', async () => {
		const vault = buildCustodyVault(
			'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
			snapshot()
		);
		const encrypted = await encryptCustodyVaultWithPassword(vault, 'correct-horse-battery');
		await expect(decryptCustodyVaultWithPassword(encrypted, 'wrong-password')).rejects.toThrow();
	});
});
