// Wallet store — reactive wrapper over core/wallet.
// Thin: no business logic, just wires core functions to UI.

import { openDb } from '$lib/core/storage';
import * as Wallet from '$lib/core/wallet';
import type { SecretWebcash, WalletStats, NetworkMode } from '$lib/core/types';

let db: IDBDatabase | null = null;

export const getDb = async (): Promise<IDBDatabase> => {
	if (!db) db = await openDb();
	return db;
};

export const setupWallet = async (masterSecret?: string) =>
	Wallet.setup(await getDb(), masterSecret);

export const getBalance = async (): Promise<number> =>
	Wallet.balance(await getDb());

export const getStats = async (): Promise<WalletStats> =>
	Wallet.stats(await getDb());

export const getWebcash = async (): Promise<SecretWebcash[]> =>
	Wallet.listWebcash(await getDb());

export const getMasterSecret = async (): Promise<string | undefined> =>
	Wallet.masterSecretHex(await getDb());

export const insertWebcash = async (network: NetworkMode, webcashStr: string) =>
	Wallet.insert(await getDb(), network, webcashStr);

export const payWebcash = async (network: NetworkMode, amountWats: number, memo: string) =>
	Wallet.pay(await getDb(), network, amountWats, memo);

export const checkWallet = async (network: NetworkMode) =>
	Wallet.check(await getDb(), network);

export const mergeOutputs = async (network: NetworkMode, maxOutputs: number) =>
	Wallet.merge(await getDb(), network, maxOutputs);

export const recoverWallet = async (
	network: NetworkMode,
	masterSecret: string,
	gapLimit?: number,
	onProgress?: (chain: string, depth: number) => void
) =>
	Wallet.recover(await getDb(), network, masterSecret, gapLimit, onProgress);

export const exportWalletSnapshot = async () =>
	Wallet.exportSnapshot(await getDb());

export const importWalletSnapshot = async (snapshot: Parameters<typeof Wallet.importSnapshot>[1]) =>
	Wallet.importSnapshot(await getDb(), snapshot);
