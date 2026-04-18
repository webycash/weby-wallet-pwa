// Wallet store — all operations delegate to WASM (harmoniis-wallet BrowserWallet).
// Supports multi-family (webcash/bitcoin/rgb) and multi-labeled wallets.
// State persisted as JSON blob in IndexedDB (one DB per network).
// Encryption handled by the UI layer via encryption.ts.

import { getWasm } from '$lib/core/wasm';
import * as Persistence from '$lib/core/persistence';
import * as Server from '$lib/core/server';
import { getNetwork } from './network.svelte';
import type { NetworkMode, CheckResult, Result, WalletSnapshot } from '$lib/core/types';
import { ok, err } from '$lib/core/types';

type Wasm = Awaited<ReturnType<typeof getWasm>>;

let stateJson: string | null = null;
let stateNetwork: NetworkMode | null = null;

// ── State Management ────────────────────────────────────────────

const ensureState = async (): Promise<{ wasm: Wasm; state: string }> => {
	const wasm = await getWasm();
	const network = getNetwork();

	if (stateJson && stateNetwork === network) {
		return { wasm, state: stateJson };
	}

	const loaded = await Persistence.loadState(network);
	if (loaded) {
		stateJson = loaded;
		stateNetwork = network;
		return { wasm, state: stateJson };
	}

	const mnemonic = Persistence.getMnemonic();
	if (mnemonic) {
		stateJson = wasm.create_wallet(mnemonic);
		stateNetwork = network;
		await Persistence.saveState(network, stateJson);
		return { wasm, state: stateJson };
	}

	throw new Error('No wallet — run setup first');
};

const updateState = async (newStateJson: string): Promise<void> => {
	stateJson = newStateJson;
	stateNetwork = getNetwork();
	await Persistence.saveState(stateNetwork, newStateJson);
};

/** Clear cached state (call on network switch). */
export const resetDb = () => {
	stateJson = null;
	stateNetwork = null;
};

/** Lock the wallet (clear in-memory state). */
export const lockWallet = () => {
	stateJson = null;
	stateNetwork = null;
};

/** Get raw state JSON (for encryption). */
export const getRawState = async (): Promise<string | null> => {
	try {
		const { state } = await ensureState();
		return state;
	} catch {
		return null;
	}
};

// ── Wallet Lifecycle ────────────────────────────────────────────

export const setupWallet = async (): Promise<Result<string>> => {
	try {
		const wasm = await getWasm();
		const network = getNetwork();
		const newState = wasm.create_wallet(undefined);
		const mnemonic = wasm.get_mnemonic(newState);
		Persistence.setMnemonic(mnemonic);
		stateJson = newState;
		stateNetwork = network;
		await Persistence.saveState(network, newState);
		return ok(wasm.master_secret_hex(newState));
	} catch (e) {
		return err(`Setup failed: ${e}`);
	}
};

export const setupFromMnemonic = async (mnemonic: string): Promise<Result<string>> => {
	try {
		const wasm = await getWasm();
		const network = getNetwork();
		const newState = wasm.create_wallet(mnemonic);
		Persistence.setMnemonic(mnemonic);
		stateJson = newState;
		stateNetwork = network;
		await Persistence.saveState(network, newState);
		return ok(wasm.master_secret_hex(newState));
	} catch (e) {
		return err(`Setup failed: ${e}`);
	}
};

export const hasWallet = async (): Promise<boolean> => {
	const mnemonic = Persistence.getMnemonic();
	if (!mnemonic) return false;
	return Persistence.hasState(getNetwork());
};

// ── Multi-wallet Management ─────────────────────────────────────

export const setActive = async (family: string, label: string): Promise<void> => {
	const { wasm, state } = await ensureState();
	await updateState(wasm.set_active(state, family, label));
};

export const addWallet = async (family: string, label: string): Promise<void> => {
	const { wasm, state } = await ensureState();
	await updateState(wasm.add_wallet(state, family, label));
};

export const removeWallet = async (family: string, label: string): Promise<void> => {
	const { wasm, state } = await ensureState();
	await updateState(wasm.remove_wallet(state, family, label));
};

export const renameWallet = async (family: string, oldLabel: string, newLabel: string): Promise<void> => {
	const { wasm, state } = await ensureState();
	await updateState(wasm.rename_wallet(state, family, oldLabel, newLabel));
};

export interface WalletInfo {
	family: string;
	label: string;
	balance: number;
	output_count: number;
}

export const listWallets = async (family: string): Promise<WalletInfo[]> => {
	const { wasm, state } = await ensureState();
	return wasm.list_wallets(state, family) as WalletInfo[];
};

export const getActiveFamily = async (): Promise<string> => {
	const { wasm, state } = await ensureState();
	return wasm.active_family(state);
};

export const getActiveLabel = async (): Promise<string> => {
	const { wasm, state } = await ensureState();
	return wasm.active_label(state);
};

// ── Balance & Queries ───────────────────────────────────────────

export const getBalance = async (): Promise<number> => {
	const { wasm, state } = await ensureState();
	return Number(wasm.wallet_balance(state));
};

export const getStats = async () => {
	const { wasm, state } = await ensureState();
	return wasm.wallet_stats(state);
};

export const getWebcash = async () => {
	const { state } = await ensureState();
	const parsed = JSON.parse(state);
	const key = `${parsed.active_family}:${parsed.active_label}`;
	const family = parsed.wallets[key];
	if (!family) return [];
	return family.outputs
		.filter((o: { spent: boolean }) => !o.spent)
		.map((o: { secret: string; amount: number }) => ({
			secret: o.secret,
			amountWats: o.amount
		}));
};

export const getMasterSecret = async (): Promise<string | undefined> => {
	try {
		const { wasm, state } = await ensureState();
		return wasm.master_secret_hex(state);
	} catch {
		return undefined;
	}
};

export const getMnemonic = async (): Promise<string | undefined> => {
	try {
		const { wasm, state } = await ensureState();
		return wasm.get_mnemonic(state);
	} catch {
		return Persistence.getMnemonic() ?? undefined;
	}
};

// ── Insert (import webcash) ─────────────────────────────────────

export const insertWebcash = async (network: NetworkMode, webcashStr: string): Promise<Result<void>> => {
	try {
		const { wasm, state } = await ensureState();
		const effectJson = wasm.prepare_insert(state, webcashStr);
		const effect = JSON.parse(effectJson);
		await Server.replace(network, effect.replace_request);
		await updateState(wasm.apply_insert(state, effectJson));
		return ok(undefined);
	} catch (e) {
		return err(`Insert failed: ${e}`);
	}
};

// ── Pay ─────────────────────────────────────────────────────────

export const payWebcash = async (network: NetworkMode, amountWats: number): Promise<Result<string>> => {
	try {
		const { wasm, state } = await ensureState();
		const effectJson = wasm.prepare_payment(state, BigInt(amountWats));
		const effect = JSON.parse(effectJson);
		await Server.replace(network, effect.replace_request);
		await updateState(wasm.apply_payment(state, effectJson));
		return ok(effect.payment_webcash);
	} catch (e) {
		return err(`Payment failed: ${e}`);
	}
};

// ── Check ───────────────────────────────────────────────────────

export const checkWallet = async (network: NetworkMode): Promise<Result<CheckResult>> => {
	try {
		const { wasm, state } = await ensureState();
		const publicStrings: string[] = wasm.prepare_check(state);
		if (!publicStrings.length) return ok({ validCount: 0, spentCount: 0, unknownCount: 0 });

		const response = await Server.healthCheck(network, publicStrings);
		const results: Record<string, boolean> = {};
		for (const [webcashKey, r] of Object.entries(response.results ?? {})) {
			const hash = webcashKey.split(':')[2];
			if (hash && r.spent !== null) results[hash] = r.spent === true;
		}

		await updateState(wasm.apply_check(state, JSON.stringify(results)));
		const validCount = Object.values(results).filter(s => !s).length;
		const spentCount = Object.values(results).filter(s => s).length;
		return ok({ validCount, spentCount, unknownCount: 0 });
	} catch (e) {
		return err(`Check failed: ${e}`);
	}
};

// ── Merge ───────────────────────────────────────────────────────

export const mergeOutputs = async (network: NetworkMode, maxOutputs: number): Promise<Result<string>> => {
	try {
		const { wasm, state } = await ensureState();
		const effect = wasm.prepare_merge(state, maxOutputs);
		if (!effect) return ok('No consolidation needed');

		const effectJson = JSON.stringify(effect);
		await Server.replace(network, effect.replace_request);
		await updateState(wasm.apply_merge(state, effectJson));
		return ok(`${effect.mark_spent_secrets.length} outputs merged`);
	} catch (e) {
		return err(`Merge failed: ${e}`);
	}
};

// ── Recover ─────────────────────────────────────────────────────

export const recoverWallet = async (
	network: NetworkMode,
	mnemonic: string,
	gapLimit: number = 20,
	onProgress?: (chain: string, depth: number) => void
): Promise<Result<{ recoveredCount: number; totalAmount: number }>> => {
	try {
		await setupFromMnemonic(mnemonic);
		const wasm = await getWasm();
		let currentState = stateJson!;
		let recoveredCount = 0;
		let totalAmount = 0;

		for (const chain of ['RECEIVE', 'CHANGE', 'MINING']) {
			let currentDepth = 0;
			let consecutiveEmpty = 0;

			while (consecutiveEmpty < gapLimit && currentDepth < 1000) {
				onProgress?.(chain, currentDepth);
				const batchJson = wasm.prepare_recover_batch(currentState, chain, BigInt(currentDepth), BigInt(gapLimit));
				const batch = JSON.parse(batchJson);

				try {
					const response = await Server.healthCheck(network, batch.public_webcash_strings);
					const results: Record<string, { amount: number; spent: boolean }> = {};
					let foundAny = false;

					for (const [webcashKey, r] of Object.entries(response.results ?? {})) {
						const hash = webcashKey.split(':')[2];
						if (!hash) continue;
						if (r.spent !== null) foundAny = true;
						if (r.spent === false && r.amount) {
							const amount = Number(wasm.parse_amount(r.amount));
							if (amount > 0) results[hash] = { amount, spent: false };
						}
					}

					if (Object.keys(results).length > 0) {
						currentState = wasm.apply_recover_batch(currentState, batchJson, JSON.stringify(results));
						recoveredCount += Object.keys(results).length;
						totalAmount += Object.values(results).reduce((s, r) => s + r.amount, 0);
					}
					consecutiveEmpty = foundAny ? 0 : consecutiveEmpty + gapLimit;
				} catch {
					consecutiveEmpty += gapLimit;
				}
				currentDepth += gapLimit;
			}

			const finalDepth = Math.max(currentDepth - consecutiveEmpty, 0);
			if (finalDepth > 0) {
				currentState = wasm.set_depth(currentState, chain, BigInt(finalDepth));
			}
		}

		await updateState(currentState);
		return ok({ recoveredCount, totalAmount });
	} catch (e) {
		return err(`Recovery failed: ${e}`);
	}
};

// ── Mining Support ──────────────────────────────────────────────

export const buildMiningParams = async (difficulty: number, miningAmount: string) => {
	const { wasm, state } = await ensureState();
	return JSON.parse(wasm.build_mining_params(state, difficulty, miningAmount));
};

export const storeMined = async (secret: string, amountWats: number) => {
	const { wasm, state } = await ensureState();
	await updateState(wasm.store_mined_output(state, secret, BigInt(amountWats)));
};

// ── Snapshot ────────────────────────────────────────────────────

export const exportWalletSnapshot = async (): Promise<WalletSnapshot> => {
	const { wasm, state } = await ensureState();
	return JSON.parse(wasm.export_snapshot(state));
};

export const importWalletSnapshot = async (snapshot: WalletSnapshot): Promise<Result<void>> => {
	try {
		const mnemonic = Persistence.getMnemonic();
		if (!mnemonic) return err('No mnemonic found');

		const wasm = await getWasm();
		let newState = wasm.create_wallet(mnemonic);
		for (const output of snapshot.unspent_outputs) {
			newState = wasm.store_mined_output(newState, output.secret, BigInt(output.amount));
		}
		for (const [chain, depth] of Object.entries(snapshot.depths)) {
			newState = wasm.set_depth(newState, chain, BigInt(depth));
		}
		await updateState(newState);
		return ok(undefined);
	} catch (e) {
		return err(`Import failed: ${e}`);
	}
};

// ── Formatting Helpers ──────────────────────────────────────────

export const formatAmount = async (wats: number): Promise<string> => {
	const wasm = await getWasm();
	return wasm.format_amount(BigInt(wats));
};

export const parseAmount = async (s: string): Promise<number> => {
	const wasm = await getWasm();
	return Number(wasm.parse_amount(s));
};

export const secretToPublic = async (secret: string): Promise<string> => {
	const wasm = await getWasm();
	return wasm.secret_to_public_hash(secret);
};

export const formatWebcash = async (secret: string, amountWats: number): Promise<string> => {
	const wasm = await getWasm();
	return wasm.format_webcash(secret, BigInt(amountWats));
};

export const formatPublicWebcash = async (hash: string, amountWats: number): Promise<string> => {
	const wasm = await getWasm();
	return wasm.format_public_webcash(hash, BigInt(amountWats));
};

export const parseWebcash = async (s: string) => {
	const wasm = await getWasm();
	return wasm.parse_webcash(s);
};
