// Wallet reset — single source of truth for deletion logic.

export const deleteAllDatabases = (): Promise<void[]> => Promise.all([
	new Promise<void>((r) => { const req = indexedDB.deleteDatabase('weby-wallet-production'); req.onsuccess = () => r(); req.onerror = () => r(); req.onblocked = () => r(); }),
	new Promise<void>((r) => { const req = indexedDB.deleteDatabase('weby-wallet-testnet'); req.onsuccess = () => r(); req.onerror = () => r(); req.onblocked = () => r(); }),
]);

export const clearAllStorage = (): void => {
	for (const k of [
		'weby_master_secret', 'weby_encrypted_wallet', 'weby_passkey_credential',
		'weby_network_mode', 'weby_encryption_type', 'weby_last_backup',
		'weby_wallet_exists', 'weby_webcash_tos_accepted', 'weby_license_accepted',
		'weby_backup_dismissed_session'
	]) localStorage.removeItem(k);
};

export const resetWallet = async (): Promise<void> => {
	await deleteAllDatabases();
	clearAllStorage();
};
