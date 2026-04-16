// Settings store — persisted in localStorage.
// Tracks license acceptance, encryption config, backup status.

const KEYS = {
	LICENSE: 'weby_license_accepted',
	WALLET_EXISTS: 'weby_wallet_exists',
	LAST_BACKUP: 'weby_last_backup',
	ENCRYPTION_TYPE: 'weby_encryption_type',
	BACKUP_DISMISSED: 'weby_backup_dismissed_session'
} as const;

const get = (key: string): string | null =>
	typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;

const set = (key: string, value: string): void => {
	if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
};

const del = (key: string): void => {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
};

// ── License ──────────────────────────────────────────────────────

export const licenseAccepted = (): boolean => get(KEYS.LICENSE) === 'true';
export const acceptLicense = (): void => set(KEYS.LICENSE, 'true');

// ── Wallet existence ─────────────────────────────────────────────

export const walletExists = (): boolean => get(KEYS.WALLET_EXISTS) === 'true';
export const markWalletCreated = (): void => set(KEYS.WALLET_EXISTS, 'true');
export const clearWallet = (): void => del(KEYS.WALLET_EXISTS);

// ── Backup ───────────────────────────────────────────────────────

export const backedUp = (): boolean => get(KEYS.LAST_BACKUP) !== null;
export const markBackedUp = (): void => set(KEYS.LAST_BACKUP, new Date().toISOString());
export const backupDismissed = (): boolean => {
	if (typeof sessionStorage === 'undefined') return false;
	return sessionStorage.getItem(KEYS.BACKUP_DISMISSED) === 'true';
};
export const dismissBackup = (): void => {
	if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(KEYS.BACKUP_DISMISSED, 'true');
};

// ── Encryption ───────────────────────────────────────────────────

export type EncryptionType = 'none' | 'password' | 'passkey';
export const encryptionType = (): EncryptionType =>
	(get(KEYS.ENCRYPTION_TYPE) as EncryptionType) ?? 'none';
export const setEncryptionType = (t: EncryptionType): void => set(KEYS.ENCRYPTION_TYPE, t);
