import { describe, expect, it } from 'vitest';
import { selectWallet, selectedEntry, upsertWallet, type WalletRegistryState } from './wallet-registry';

describe('WalletRegistry (R2)', () => {
	it('upserts by fingerprint and selects fail-closed', () => {
		let reg: WalletRegistryState = { wallets: [], selected: null };
		reg = upsertWallet(reg, {
			fingerprintHex: 'aa'.repeat(20),
			sourceDomain: 'weby.cash',
			storageKind: 'Local',
		});
		reg = upsertWallet(reg, {
			fingerprintHex: 'bb'.repeat(20),
			sourceDomain: 'extro.life',
			storageKind: 'CrossDomainGranted',
		});
		expect(reg.wallets).toHaveLength(2);
		reg = upsertWallet(reg, {
			fingerprintHex: 'aa'.repeat(20),
			sourceDomain: 'weby.cash',
			storageKind: 'Local',
		});
		expect(reg.wallets).toHaveLength(2);
		expect(selectWallet(reg, 'ff'.repeat(20))).toBeNull();
		const selected = selectWallet(reg, 'bb'.repeat(20));
		expect(selected?.selected).toBe('bb'.repeat(20));
		expect(selectedEntry(selected!).storageKind).toBe('CrossDomainGranted');
	});
});
