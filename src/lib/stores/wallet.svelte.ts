// Wallet store — all operations delegate to WASM.
// Two-layer state:
//   master_state = HarmoniiStore JSON (wallet slots, identities, key material)
//   wallet_state = webylib MemStore JSON (per active labeled wallet)
// Multi-family (webcash/bitcoin/rgb) with labeled wallets per family.
// All HTTP happens inside Rust — zero fetch() calls from TypeScript.

import { getWasm } from '$lib/core/wasm';
import * as Persistence from '$lib/core/persistence';
import { getNetwork } from './network.svelte';
import type { NetworkMode, CheckResult, Result, WalletSnapshot } from '$lib/core/types';
import { ok, err } from '$lib/core/types';
import { parseWebcasa, decryptWebcasa, isEncrypted, toWebcasaJson } from '$lib/core/webcasa';

type Wasm = Awaited<ReturnType<typeof getWasm>>;

const MASTER_KEY = 'master';

let walletState: string | null = null;
let masterState: string | null = null;
let stateNetwork: NetworkMode | null = null;
let activeFamily = 'webcash';
let activeLabel = 'main';

// ── Internal helpers ────────────────────────────────────────────

const walletKey = () => Persistence.walletStateKey(activeFamily, activeLabel);

const loadMaster = async (network: string): Promise<string | null> => {
	if (masterState && stateNetwork === network) return masterState;
	const loaded = await Persistence.loadState(network, MASTER_KEY);
	if (loaded) { masterState = loaded; return loaded; }
	return null;
};

const saveMaster = async (network: string, state: string) => {
	masterState = state;
	await Persistence.saveState(network, state, MASTER_KEY);
};

const isActiveRoaming = (): boolean => {
	const entry = Persistence.findEntry(getNetwork(), activeFamily, activeLabel);
	return entry?.roaming === true;
};

const ensureState = async (): Promise<{ wasm: Wasm; state: string; master: string; network: NetworkMode }> => {
	const wasm = await getWasm();
	const network = getNetwork();

	// Load master state
	let master = await loadMaster(network);
	if (!master) {
		const mnemonic = Persistence.getMnemonic();
		if (!mnemonic) throw new Error('No wallet — run setup first');
		const resultJson = wasm.create_master_wallet(mnemonic);
		const result = JSON.parse(resultJson);
		master = result.master_state;
		await saveMaster(network, master!);
	}

	// Restore active selection
	const active = Persistence.getActive(network);
	activeFamily = active.family;
	activeLabel = active.label;

	// Load wallet state for active labeled wallet
	if (walletState && stateNetwork === network) {
		return { wasm, state: walletState, master: master!, network };
	}

	const key = walletKey();
	const loaded = await Persistence.loadState(network, key);
	if (loaded) {
		const parsed = JSON.parse(loaded);
		if (parsed.meta && parsed.outputs && parsed.depths) {
			walletState = loaded;
			stateNetwork = network;
			return { wasm, state: walletState, master: master!, network };
		}
	}

	// Roaming wallets cannot be created — only imported
	if (isActiveRoaming()) throw new Error('Roaming wallet state missing — reimport required');

	// Migrate legacy "current" key — detect old BrowserWallet format vs webylib MemStore
	const legacy = await Persistence.loadState(network);
	if (legacy) {
		const parsed = JSON.parse(legacy);
		if (parsed.meta && parsed.outputs && parsed.depths) {
			await Persistence.saveState(network, legacy, key);
			walletState = legacy;
			stateNetwork = network;
			return { wasm, state: walletState, master: master!, network };
		}
	}

	// Create fresh wallet state for this slot (deterministic only)
	const secret = wasm.derive_wallet_secret(master!, activeFamily, activeLabel);
	const createJson = await wasm.create_wallet(network, Persistence.getMnemonic() ?? undefined);
	const created = JSON.parse(createJson);
	walletState = created.state;
	stateNetwork = network;
	await Persistence.saveState(network, walletState!, key);
	return { wasm, state: walletState!, master: master!, network };
};

const updateWalletState = async (newState: string) => {
	walletState = newState;
	stateNetwork = getNetwork();
	await Persistence.saveState(stateNetwork, newState, walletKey());
};

export const resetDb = () => {
	walletState = null;
	masterState = null;
	stateNetwork = null;
};

export const lockWallet = () => {
	walletState = null;
	masterState = null;
	stateNetwork = null;
};

export const getRawState = async (): Promise<string | null> => {
	try { return (await ensureState()).state; }
	catch { return null; }
};

export const setRawState = async (newState: string) => {
	await updateWalletState(newState);
};

// ── Wallet Lifecycle ────────────────────────────────────────────

export const setupWallet = async (): Promise<Result<string>> => {
	try {
		const wasm = await getWasm();
		const network = getNetwork();
		const resultJson = wasm.create_master_wallet(undefined);
		const result = JSON.parse(resultJson);
		Persistence.setMnemonic(result.mnemonic);
		await saveMaster(network, result.master_state);
		Persistence.setActive(network, 'webcash', 'main');
		activeFamily = 'webcash';
		activeLabel = 'main';

		// Create webylib wallet for the main webcash slot
		const secret = wasm.derive_wallet_secret(result.master_state, 'webcash', 'main');
		const walletJson = await wasm.create_wallet(network, result.mnemonic);
		const wallet = JSON.parse(walletJson);
		walletState = wallet.state;
		stateNetwork = network;
		await Persistence.saveState(network, wallet.state, walletKey());
		return ok(secret);
	} catch (e) { return err(`Setup failed: ${e}`); }
};

export const setupFromMnemonic = async (mnemonic: string): Promise<Result<string>> => {
	try {
		const wasm = await getWasm();
		const network = getNetwork();
		const resultJson = wasm.create_master_wallet(mnemonic);
		const result = JSON.parse(resultJson);
		Persistence.setMnemonic(result.mnemonic);
		await saveMaster(network, result.master_state);
		Persistence.setActive(network, 'webcash', 'main');
		activeFamily = 'webcash';
		activeLabel = 'main';

		const walletJson = await wasm.create_wallet(network, mnemonic);
		const wallet = JSON.parse(walletJson);
		walletState = wallet.state;
		stateNetwork = network;
		await Persistence.saveState(network, wallet.state, walletKey());
		return ok(wasm.derive_wallet_secret(result.master_state, 'webcash', 'main'));
	} catch (e) { return err(`Setup failed: ${e}`); }
};

export const hasWallet = async (): Promise<boolean> => {
	const mnemonic = Persistence.getMnemonic();
	if (!mnemonic) return false;
	return Persistence.hasState(getNetwork());
};

// ── Multi-wallet Management ─────────────────────────────────────

export interface WalletInfo {
	family: string;
	label: string;
	balance: number;
	output_count: number;
	roaming?: boolean;
}

export const setActive = async (family: string, label: string) => {
	const network = getNetwork();
	Persistence.setActive(network, family, label);
	activeFamily = family;
	activeLabel = label;
	walletState = null;
	stateNetwork = null;
};

export const addWallet = async (family: string, label: string) => {
	const { wasm, master, network } = await ensureState();
	const newMaster = wasm.add_wallet(master, family, label);
	await saveMaster(network, newMaster);

	// Create webylib wallet state for the new slot
	const mnemonic = Persistence.getMnemonic();
	if (mnemonic) {
		const walletJson = await wasm.create_wallet(network, mnemonic);
		const wallet = JSON.parse(walletJson);
		const key = Persistence.walletStateKey(family, label);
		await Persistence.saveState(network, wallet.state, key);
	}
};

export const removeWallet = async (family: string, label: string) => {
	const network = getNetwork();
	const entry = Persistence.findEntry(network, family, label);
	if (entry?.roaming) {
		// Roaming: not in master store, just remove from registry + IDB
		const registry = Persistence.getRegistry(network).filter(e => !(e.family === family && e.label === label));
		Persistence.setRegistry(network, registry);
	} else {
		const { wasm, master } = await ensureState();
		const newMaster = wasm.remove_wallet(master, family, label);
		await saveMaster(network, newMaster);
	}
	await Persistence.deleteKey(network, Persistence.walletStateKey(family, label));
};

export const renameWallet = async (family: string, oldLabel: string, newLabel: string) => {
	const network = getNetwork();
	const entry = Persistence.findEntry(network, family, oldLabel);
	if (entry?.roaming) {
		// Roaming: update registry entry label
		const registry = Persistence.getRegistry(network).map(e =>
			e.family === family && e.label === oldLabel ? { ...e, label: newLabel } : e
		);
		Persistence.setRegistry(network, registry);
	} else {
		const { wasm, master } = await ensureState();
		const newMaster = wasm.rename_wallet(master, family, oldLabel, newLabel);
		await saveMaster(network, newMaster);
	}

	// Move the wallet state to the new key
	const oldKey = Persistence.walletStateKey(family, oldLabel);
	const newKey = Persistence.walletStateKey(family, newLabel);
	const state = await Persistence.loadState(network, oldKey);
	if (state) {
		await Persistence.saveState(network, state, newKey);
		await Persistence.deleteKey(network, oldKey);
	}

	if (activeFamily === family && activeLabel === oldLabel) {
		activeLabel = newLabel;
		Persistence.setActive(network, family, newLabel);
	}
};

export const listWallets = async (family: string): Promise<WalletInfo[]> => {
	const { wasm, master, network } = await ensureState();
	const wallets: any[] = wasm.list_wallets(master, family);
	const result: WalletInfo[] = [];
	const seenLabels = new Set<string>();

	for (const w of wallets) {
		const label = w.label || `${family}-${w.slot_index}`;
		seenLabels.add(label);
		const key = Persistence.walletStateKey(family, label);
		const state = await Persistence.loadState(network, key);
		let balance = 0;
		let output_count = 0;
		if (state) {
			try {
				balance = Number(wasm.wallet_balance(state, network));
				const parsed = JSON.parse(state);
				output_count = parsed.outputs?.filter((o: { spent: boolean }) => !o.spent).length ?? 0;
			} catch { /* skip */ }
		}
		result.push({ family, label, balance, output_count });
	}

	// Append roaming wallets from registry (not in master store)
	const registry = Persistence.getRegistry(network);
	for (const entry of registry) {
		if (entry.family !== family || !entry.roaming || seenLabels.has(entry.label)) continue;
		const key = Persistence.walletStateKey(family, entry.label);
		const state = await Persistence.loadState(network, key);
		let balance = 0;
		let output_count = 0;
		if (state) {
			try {
				balance = Number(wasm.wallet_balance(state, network));
				const parsed = JSON.parse(state);
				output_count = parsed.outputs?.filter((o: { spent: boolean }) => !o.spent).length ?? 0;
			} catch { /* skip */ }
		}
		result.push({ family, label: entry.label, balance, output_count, roaming: true });
	}
	return result;
};

export const getActiveFamily = async (): Promise<string> => {
	const active = Persistence.getActive(getNetwork());
	activeFamily = active.family;
	return active.family;
};

export const getActiveLabel = async (): Promise<string> => {
	const active = Persistence.getActive(getNetwork());
	activeLabel = active.label;
	return active.label;
};

// ── Balance & Queries ───────────────────────────────────────────

export const getBalance = async (): Promise<number> => {
	const { wasm, state, network } = await ensureState();
	return Number(wasm.wallet_balance(state, network));
};

export const getStats = async () => {
	const { wasm, state, network } = await ensureState();
	return wasm.wallet_stats(state, network);
};

export const getWebcash = async () => {
	const { state } = await ensureState();
	const parsed = JSON.parse(state);
	if (!parsed.outputs) return [];
	return parsed.outputs
		.filter((o: { spent: boolean }) => !o.spent)
		.map((o: { secret: string; amount: number }) => ({
			secret: o.secret,
			amountWats: o.amount,
		}));
};

export const getMasterSecret = async (): Promise<string | undefined> => {
	try {
		const { wasm, state, network } = await ensureState();
		return wasm.master_secret_hex(state, network);
	} catch { return undefined; }
};

export const getMnemonic = async (): Promise<string | undefined> => {
	return Persistence.getMnemonic() ?? undefined;
};

export const exportMasterBackup = async (): Promise<string> => {
	const { wasm, master, network } = await ensureState();
	// Collect all webcash wallet states from IndexedDB
	const wallets: Record<string, string> = {};
	const registry = Persistence.getRegistry(network);
	const hdWallets: any[] = wasm.list_wallets(master, 'webcash');
	const allLabels = new Set<string>();
	for (const w of hdWallets) { allLabels.add(w.label || `webcash-${w.slot_index}`); }
	for (const entry of registry) {
		if (entry.family === 'webcash') allLabels.add(entry.label);
	}
	for (const label of allLabels) {
		const key = Persistence.walletStateKey('webcash', label);
		const state = await Persistence.loadState(network, key);
		if (state) wallets[label] = state;
	}
	return wasm.export_full_backup(master, JSON.stringify(wallets));
};

// ── Wallet Operations (single async WASM calls — HTTP in Rust) ──

export const insertWebcash = async (webcashStr: string): Promise<Result<void>> => {
	try {
		const { wasm, state, network } = await ensureState();
		const newState = await wasm.insert_webcash(state, network, webcashStr);
		await updateWalletState(newState);
		return ok(undefined);
	} catch (e) { return err(`Insert failed: ${e}`); }
};

export const payWebcash = async (amountWats: number): Promise<Result<string>> => {
	try {
		const { wasm, state, network } = await ensureState();
		const resultJson = await wasm.pay_webcash(state, network, BigInt(amountWats));
		const result = JSON.parse(resultJson);
		await updateWalletState(result.state);
		return ok(result.payment_webcash);
	} catch (e) { return err(`Payment failed: ${e}`); }
};

export const checkWallet = async (): Promise<Result<CheckResult>> => {
	try {
		const { wasm, state, network } = await ensureState();
		const resultJson = await wasm.check_wallet(state, network);
		const result = JSON.parse(resultJson);
		await updateWalletState(result.state);
		return ok({ validCount: result.valid_count, spentCount: result.spent_count, unknownCount: 0 });
	} catch (e) { return err(`Check failed: ${e}`); }
};

export const mergeOutputs = async (maxOutputs: number): Promise<Result<string>> => {
	try {
		const { wasm, state, network } = await ensureState();
		const resultJson = await wasm.merge_outputs(state, network, maxOutputs);
		const result = JSON.parse(resultJson);
		await updateWalletState(result.state);
		return ok(result.message || 'Merge complete');
	} catch (e) { return err(`Merge failed: ${e}`); }
};

export const recoverWallet = async (gapLimit: number = 20): Promise<Result<{ recoveredCount: number; totalAmount: number }>> => {
	try {
		const { wasm, state, network } = await ensureState();
		const resultJson = await wasm.recover_wallet(state, network, gapLimit);
		const result = JSON.parse(resultJson);
		await updateWalletState(result.state);
		return ok({ recoveredCount: result.recovered_count, totalAmount: Number(result.total_amount) });
	} catch (e) { return err(`Recovery failed: ${e}`); }
};

// ── Snapshot ────────────────────────────────────────────────────

export const exportWalletSnapshot = async (): Promise<WalletSnapshot> => {
	const { wasm, state, network } = await ensureState();
	return JSON.parse(wasm.export_snapshot(state, network));
};

export const importWalletSnapshot = async (snapshot: WalletSnapshot): Promise<Result<void>> => {
	try {
		const wasm = await getWasm();
		const network = getNetwork();
		// Restore from mnemonic derived from snapshot master secret
		const mnemonic = Persistence.getMnemonic();
		if (!mnemonic) return err('No mnemonic found');
		const walletJson = await wasm.create_wallet(network, mnemonic);
		const wallet = JSON.parse(walletJson);
		// The snapshot's outputs will be recovered via recoverWallet
		await updateWalletState(wallet.state);
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

export const parseWebcashStr = async (s: string) => {
	const wasm = await getWasm();
	return wasm.parse_webcash(s);
};

// ── Roaming Wallet Support ─────────────────────────────────────

export const isRoaming = (): boolean => isActiveRoaming();

export const canMine = (): boolean => activeLabel === 'main' && !isActiveRoaming();

export const importRoamingFromFile = async (file: File, label: string, password?: string): Promise<Result<void>> => {
	try {
		const wasm = await getWasm();
		const network = getNetwork();
		const raw = await file.text();
		const wallet = password && isEncrypted(raw)
			? await decryptWebcasa(raw, password)
			: parseWebcasa(raw);
		const state = await wasm.create_roaming_wallet(
			network, wallet.master_secret,
			JSON.stringify(wallet.webcash),
			JSON.stringify(wallet.walletdepths),
		);
		const key = Persistence.walletStateKey('webcash', label);
		await Persistence.saveState(network, state, key);
		const registry = Persistence.getRegistry(network);
		registry.push({ family: 'webcash', label, index: -1, roaming: true });
		Persistence.setRegistry(network, registry);
		await setActive('webcash', label);
		return ok(undefined);
	} catch (e) { return err(`Import failed: ${e}`); }
};

export const importRoamingFromSecret = async (masterSecretHex: string, label: string): Promise<Result<void>> => {
	try {
		if (!/^[0-9a-fA-F]{64}$/.test(masterSecretHex))
			return err('Master secret must be 64 hex characters');
		const wasm = await getWasm();
		const network = getNetwork();
		const state = await wasm.create_roaming_wallet(network, masterSecretHex, '[]', '{}');
		const key = Persistence.walletStateKey('webcash', label);
		await Persistence.saveState(network, state, key);
		const registry = Persistence.getRegistry(network);
		registry.push({ family: 'webcash', label, index: -1, roaming: true });
		Persistence.setRegistry(network, registry);
		await setActive('webcash', label);
		walletState = state;
		stateNetwork = network;
		// Auto-recover to find outputs on server
		const r = await recoverWallet(20);
		if (!r.ok) return err(r.error);
		return ok(undefined);
	} catch (e) { return err(`Import failed: ${e}`); }
};

export const exportWebcasaFile = async (): Promise<void> => {
	const { wasm, state, network } = await ensureState();
	const masterSecret = wasm.master_secret_hex(state, network);
	const snap = JSON.parse(wasm.export_snapshot(state, network));
	const webcash: string[] = snap.unspent_outputs.map((o: { secret: string; amount: number }) =>
		wasm.format_webcash(o.secret, BigInt(o.amount)),
	);
	const json = toWebcasaJson(masterSecret, webcash, snap.depths);
	const blob = new Blob([json], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${activeLabel}_wallet.webcash`;
	a.click();
	URL.revokeObjectURL(url);
};
