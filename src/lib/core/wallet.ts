// Wallet operations — pure functional core.
// Mirrors webylib/src/wallet/operations.rs faithfully.

import type {
	NetworkMode, SecretWebcash, PublicWebcash,
	WalletStats, CheckResult, WalletSnapshot, Result, StoredOutput
} from './types';
import { ok, err, CHAIN } from './types';
import * as Storage from './storage';
import * as Server from './server';
import { getWasm } from './wasm';

// ── Helpers ──────────────────────────────────────────────────────

const hexToBytes = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return bytes;
};

const sha256ofSecret = async (secret: string): Promise<string> => {
	const wasm = await getWasm();
	return wasm.secret_to_public(secret);
};

const secretHashBuffer = async (secret: string): Promise<ArrayBuffer> => {
	const hex = await sha256ofSecret(secret);
	const bytes = hexToBytes(hex);
	return bytes.buffer as ArrayBuffer;
};

const now = () => new Date().toISOString();

// ── Setup ────────────────────────────────────────────────────────

export const setup = async (db: IDBDatabase, masterSecretHex?: string): Promise<Result<string>> => {
	try {
		const wasm = await getWasm();
		const masterSecret = masterSecretHex ?? await wasm.generate_master_secret();

		if (masterSecret.length !== 64 || !/^[0-9a-f]+$/i.test(masterSecret)) {
			return err('Master secret must be 64 hex characters (32 bytes)');
		}

		await Storage.setMeta(db, 'master_secret', masterSecret);
		for (const code of ['RECEIVE', 'PAY', 'CHANGE', 'MINING']) {
			await Storage.setDepth(db, code, 0);
		}
		return ok(masterSecret);
	} catch (e) {
		return err(`Setup failed: ${e}`);
	}
};

// ── Balance & Listing ────────────────────────────────────────────

export const balance = async (db: IDBDatabase): Promise<number> => {
	const outputs = await Storage.getUnspent(db);
	return outputs.reduce((sum, o) => sum + o.amount, 0);
};

export const listWebcash = async (db: IDBDatabase): Promise<SecretWebcash[]> => {
	const outputs = await Storage.getUnspent(db);
	return outputs.map(o => ({ secret: o.secret, amountWats: o.amount }));
};

export const listPublicWebcash = async (db: IDBDatabase): Promise<PublicWebcash[]> => {
	const secrets = await listWebcash(db);
	return Promise.all(secrets.map(async s => ({
		hash: await sha256ofSecret(s.secret),
		amountWats: s.amountWats
	})));
};

export const stats = async (db: IDBDatabase): Promise<WalletStats> => {
	const all = await Storage.getAllOutputs(db);
	const unspent = all.filter(o => o.spent === 0);
	const spentHashes = await Storage.getSpentHashes(db);

	return {
		totalWebcash: all.length,
		unspentWebcash: unspent.length,
		spentWebcash: spentHashes.length,
		totalBalance: unspent.reduce((sum, o) => sum + o.amount, 0)
	};
};

export const masterSecretHex = (db: IDBDatabase): Promise<string | undefined> =>
	Storage.getMeta(db, 'master_secret');

// ── Insert ───────────────────────────────────────────────────────

export const insert = async (
	db: IDBDatabase,
	network: NetworkMode,
	webcashStr: string
): Promise<Result<void>> => {
	try {
		const wasm = await getWasm();
		const parsed = wasm.parse_webcash(webcashStr);
		const { secret, amount_wats } = parsed;

		const masterSecret = await Storage.getMeta(db, 'master_secret');
		if (!masterSecret) return err('No wallet — run setup first');

		const receiveDepth = await Storage.getDepth(db, 'RECEIVE');
		const newSecret = await wasm.derive_secret(masterSecret, CHAIN.RECEIVE, receiveDepth);

		const inputStr = wasm.format_webcash(secret, amount_wats);
		const outputStr = wasm.format_webcash(newSecret, amount_wats);

		const response = await Server.replace(network, {
			webcashes: [inputStr],
			new_webcashes: [outputStr],
			legalese: { terms: true }
		});

		// Store new output + increment depth
		const hashBuf = await secretHashBuffer(newSecret);
		await Storage.putOutput(db, {
			secretHash: hashBuf,
			secret: newSecret,
			amount: amount_wats,
			createdAt: now(),
			spent: 0
		});
		await Storage.setDepth(db, 'RECEIVE', receiveDepth + 1);

		return ok(undefined);
	} catch (e) {
		return err(`Insert failed: ${e}`);
	}
};

// ── Pay ──────────────────────────────────────────────────────────

export const pay = async (
	db: IDBDatabase,
	network: NetworkMode,
	amountWats: number,
	_memo: string
): Promise<Result<string>> => {
	try {
		const wasm = await getWasm();
		const masterSecret = await Storage.getMeta(db, 'master_secret');
		if (!masterSecret) return err('No wallet');

		// Select inputs (largest first)
		const inputs = await selectInputs(db, amountWats);
		if (!inputs.length) return err('Insufficient funds');

		const inputTotal = inputs.reduce((s, i) => s + i.amount, 0);
		const changeAmount = inputTotal - amountWats;

		const payDepth = await Storage.getDepth(db, 'PAY');
		const changeDepth = await Storage.getDepth(db, 'CHANGE');

		const paySecret = await wasm.derive_secret(masterSecret, CHAIN.PAY, payDepth);
		const payStr = wasm.format_webcash(paySecret, amountWats);
		const newWebcashes = [payStr];

		let changeSecret: string | undefined;
		if (changeAmount > 0) {
			changeSecret = await wasm.derive_secret(masterSecret, CHAIN.CHANGE, changeDepth);
			newWebcashes.push(wasm.format_webcash(changeSecret, changeAmount));
		}

		await Server.replace(network, {
			webcashes: inputs.map(i => wasm.format_webcash(i.secret, i.amount)),
			new_webcashes: newWebcashes,
			legalese: { terms: true }
		});

		// Mark inputs spent
		for (const input of inputs) {
			const hashBuf = await secretHashBuffer(input.secret);
			await Storage.markSpent(db, hashBuf);
			await Storage.addSpentHash(db, hashBuf, now());
		}

		// Store change
		if (changeSecret && changeAmount > 0) {
			const changeHash = await secretHashBuffer(changeSecret);
			await Storage.putOutput(db, {
				secretHash: changeHash,
				secret: changeSecret,
				amount: changeAmount,
				createdAt: now(),
				spent: 0
			});
			await Storage.setDepth(db, 'CHANGE', changeDepth + 1);
		}

		await Storage.setDepth(db, 'PAY', payDepth + 1);

		const paymentWebcash = wasm.format_webcash(paySecret, amountWats);
		return ok(paymentWebcash);
	} catch (e) {
		return err(`Payment failed: ${e}`);
	}
};

const selectInputs = async (db: IDBDatabase, amountWats: number): Promise<StoredOutput[]> => {
	const outputs = await Storage.getUnspent(db);
	outputs.sort((a, b) => b.amount - a.amount); // largest first

	const selected: StoredOutput[] = [];
	let total = 0;
	for (const o of outputs) {
		selected.push(o);
		total += o.amount;
		if (total >= amountWats) break;
	}
	return total >= amountWats ? selected : [];
};

// ── Check ────────────────────────────────────────────────────────

export const check = async (
	db: IDBDatabase,
	network: NetworkMode
): Promise<Result<CheckResult>> => {
	try {
		const wasm = await getWasm();
		const outputs = await Storage.getUnspent(db);
		if (!outputs.length) return ok({ validCount: 0, spentCount: 0, unknownCount: 0 });

		const publicStrings = await Promise.all(outputs.map(async o => {
			const hash = await sha256ofSecret(o.secret);
			return wasm.format_public_webcash(hash, o.amount);
		}));

		const response = await Server.healthCheck(network, publicStrings);
		let validCount = 0;
		let spentCount = 0;

		if (response.results) {
			for (const r of response.results) {
				if (r.spent) spentCount++;
				else validCount++;
			}
		}

		return ok({ validCount, spentCount, unknownCount: 0 });
	} catch (e) {
		return err(`Check failed: ${e}`);
	}
};

// ── Merge ────────────────────────────────────────────────────────

export const merge = async (
	db: IDBDatabase,
	network: NetworkMode,
	maxOutputs: number
): Promise<Result<string>> => {
	try {
		const wasm = await getWasm();
		const masterSecret = await Storage.getMeta(db, 'master_secret');
		if (!masterSecret) return err('No wallet');

		const allOutputs = await Storage.getUnspent(db);
		if (allOutputs.length <= 1) return ok('No consolidation needed');

		const toMerge = allOutputs.slice(0, Math.min(allOutputs.length, maxOutputs));
		if (toMerge.length <= 1) return ok('Insufficient outputs to merge');

		const totalAmount = toMerge.reduce((s, o) => s + o.amount, 0);
		const changeDepth = await Storage.getDepth(db, 'CHANGE');
		const changeSecret = await wasm.derive_secret(masterSecret, CHAIN.CHANGE, changeDepth);

		await Server.replace(network, {
			webcashes: toMerge.map(o => wasm.format_webcash(o.secret, o.amount)),
			new_webcashes: [wasm.format_webcash(changeSecret, totalAmount)],
			legalese: { terms: true }
		});

		// Mark inputs spent
		for (const o of toMerge) {
			const hashBuf = await secretHashBuffer(o.secret);
			await Storage.markSpent(db, hashBuf);
			await Storage.addSpentHash(db, hashBuf, now());
		}

		// Store consolidated output
		const changeHash = await secretHashBuffer(changeSecret);
		await Storage.putOutput(db, {
			secretHash: changeHash,
			secret: changeSecret,
			amount: totalAmount,
			createdAt: now(),
			spent: 0
		});
		await Storage.setDepth(db, 'CHANGE', changeDepth + 1);

		return ok(`${toMerge.length} outputs merged, ${wasm.format_amount(totalAmount)} preserved`);
	} catch (e) {
		return err(`Merge failed: ${e}`);
	}
};

// ── Recover ──────────────────────────────────────────────────────

export const recover = async (
	db: IDBDatabase,
	network: NetworkMode,
	masterSecretHex: string,
	gapLimit: number = 20,
	onProgress?: (chain: string, depth: number) => void
): Promise<Result<{ recoveredCount: number; totalAmount: number }>> => {
	try {
		const wasm = await getWasm();

		if (masterSecretHex.length !== 64 || !/^[0-9a-f]+$/i.test(masterSecretHex)) {
			return err('Invalid master secret format');
		}

		await Storage.setMeta(db, 'master_secret', masterSecretHex);

		let recoveredCount = 0;
		let totalAmount = 0;

		const chains = [
			{ name: 'RECEIVE', code: CHAIN.RECEIVE },
			{ name: 'CHANGE', code: CHAIN.CHANGE },
			{ name: 'MINING', code: CHAIN.MINING }
		] as const;

		for (const { name, code } of chains) {
			let currentDepth = 0;
			let consecutiveEmpty = 0;

			while (consecutiveEmpty < gapLimit && currentDepth < 1000) {
				const batch: { secret: string; publicStr: string; depth: number }[] = [];

				for (let offset = 0; offset < gapLimit; offset++) {
					const depth = currentDepth + offset;
					const secret = await wasm.derive_secret(masterSecretHex, code, depth);
					const hash = await sha256ofSecret(secret);
					batch.push({
						secret,
						publicStr: wasm.format_public_webcash(hash, 1), // dummy amount for health check
						depth
					});
				}

				onProgress?.(name, currentDepth);

				try {
					const response = await Server.healthCheck(network, batch.map(b => b.publicStr));

					let foundAny = false;
					if (response.results) {
						for (let i = 0; i < response.results.length; i++) {
							const r = response.results[i];
							if (r && !r.spent) {
								// Found unspent — store it
								const b = batch[i];
								if (b) {
									const hashBuf = await secretHashBuffer(b.secret);
									try {
										await Storage.putOutput(db, {
											secretHash: hashBuf,
											secret: b.secret,
											amount: 1, // TODO: get actual amount from server response
											createdAt: now(),
											spent: 0
										});
										recoveredCount++;
										totalAmount += 1;
										foundAny = true;
									} catch {
										// Duplicate — already stored
										foundAny = true;
									}
								}
							} else if (r?.spent) {
								foundAny = true;
							}
						}
					}

					if (foundAny) {
						consecutiveEmpty = 0;
					} else {
						consecutiveEmpty += gapLimit;
					}
				} catch {
					consecutiveEmpty += gapLimit;
				}

				currentDepth += gapLimit;
			}

			// Update depth
			const finalDepth = Math.max(currentDepth - consecutiveEmpty, 0);
			if (finalDepth > 0) {
				await Storage.setDepth(db, name, finalDepth);
			}
		}

		return ok({ recoveredCount, totalAmount });
	} catch (e) {
		return err(`Recovery failed: ${e}`);
	}
};

// ── Snapshot Export/Import ────────────────────────────────────────

export const exportSnapshot = async (db: IDBDatabase): Promise<WalletSnapshot> =>
	Storage.exportSnapshot(db, sha256ofSecret);

export const importSnapshot = async (db: IDBDatabase, snapshot: WalletSnapshot): Promise<Result<void>> => {
	try {
		await Storage.importSnapshot(db, snapshot, sha256ofSecret);
		return ok(undefined);
	} catch (e) {
		return err(`Import failed: ${e}`);
	}
};
