import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bootArkNode } from './ark-node.testkit';
import type { ExtroSend } from '$lib/modules/webycash-exchange/exchange-core';

// The journal rules run in the real extro-node WASM (Op::Exchange journal ops).
let send: ExtroSend;
vi.mock('$lib/extro', () => ({ getExtroClient: () => ({ send: (c: never) => send(c) }) }));
beforeAll(async () => {
	send = (await bootArkNode()).send;
});

import {
	CONTRACT_JOURNAL_VERSION,
	fundArkSwapContractPersisted,
	listContractRecords,
	loadContractRecord,
	memoryContractJournal,
	persistContractRecord,
	type ContractJournalRecord
} from './contract-journal';
import type { ArkSwapContract } from './swap-contract';

const contract = {
	address: 'ark1contract',
	tapTree: new Uint8Array([1, 2, 3]),
	plan: { swapId: 'swap-x', amountSats: 1000n }
} as unknown as ArkSwapContract;

const record = (over: Partial<ContractJournalRecord> = {}): ContractJournalRecord => ({
	v: CONTRACT_JOURNAL_VERSION,
	role: 'provider',
	swapId: 'swap-x',
	orderIdHex: 'aa'.repeat(16),
	network: 'bitcoin',
	refereeUrl: 'https://referee.example',
	refereeVkHex: 'bb'.repeat(32),
	contractAddress: 'ark1contract',
	arkAmountSats: '1000',
	tapTreeHex: '010203',
	requestCommitmentHex: 'cc'.repeat(32),
	providerSignedHex: 'dd',
	bearerSellerSignedHex: 'ee',
	refereeSignedResponseHex: 'ff',
	createdAtUnix: 1,
	...over
});

const wallet = () => ({ send: vi.fn(async () => '44'.repeat(32)) });

describe('contract journal funding gate', () => {
	it('refuses funding when the terms were never persisted', async () => {
		const j = memoryContractJournal();
		const w = wallet();
		await expect(fundArkSwapContractPersisted(j, w, contract, 'cc'.repeat(32))).rejects.toThrow(
			/^ARK_CONTRACT_NOT_PERSISTED: no journal record/
		);
		expect(w.send).not.toHaveBeenCalled();
	});

	it('refuses funding when the persisted record is for a different contract or terms', async () => {
		for (const over of [
			{ contractAddress: 'ark1other' },
			{ arkAmountSats: '999' },
			{ requestCommitmentHex: '00'.repeat(32) }
		]) {
			const j = memoryContractJournal();
			await persistContractRecord(j, record(over));
			const w = wallet();
			await expect(fundArkSwapContractPersisted(j, w, contract, 'cc'.repeat(32))).rejects.toThrow(
				/ARK_CONTRACT_NOT_PERSISTED/
			);
			expect(w.send).not.toHaveBeenCalled();
		}
	});

	it('refuses to persist incomplete records and detects read-back mismatch', async () => {
		const j = memoryContractJournal();
		await expect(persistContractRecord(j, record({ providerSignedHex: '' }))).rejects.toThrow(/missing providerSignedHex/);
		const lossy = { ...memoryContractJournal(), get: async () => '{}' };
		await expect(persistContractRecord(lossy, record())).rejects.toThrow(/read-back mismatch/);
		const failing = { ...memoryContractJournal(), put: async () => Promise.reject(new Error('quota')) };
		await expect(persistContractRecord(failing, record())).rejects.toThrow(/write failed: quota/);
	});

	it('funds only after a verified persist and records the funding txid', async () => {
		const j = memoryContractJournal();
		await persistContractRecord(j, record());
		const w = wallet();
		const out = await fundArkSwapContractPersisted(j, w, contract, 'CC'.repeat(32));
		expect(w.send).toHaveBeenCalledTimes(1);
		expect(out.arkTxId).toBe('44'.repeat(32));
		expect((await loadContractRecord(j, 'swap-x'))?.fundingArkTxId).toBe('44'.repeat(32));
		expect((await listContractRecords(j)).map((r) => r.swapId)).toEqual(['swap-x']);
	});
});
