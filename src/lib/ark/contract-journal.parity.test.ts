// Parity gate (ADR-0007, audit H3): the swap-contract journal rules live in
// extro-node (`Op::Exchange JournalCanonical` / `JournalCheck`). Every case
// of `@extro/node/vectors/contract_journal.json` must match (a) the live op
// and (b) the wallet's journal (`persistContractRecord` writes exactly the
// canonical bytes; `assertContractPersisted` refuses with the same detail).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { newRequestId } from '@extro/node';
import { bootArkNode } from '$lib/ark/ark-node.testkit';
import type { ExtroSend } from '$lib/modules/webycash-exchange/exchange-core';

let send: ExtroSend;
vi.mock('$lib/extro', () => ({ getExtroClient: () => ({ send: (c: never) => send(c) }) }));

import {
	assertContractPersisted,
	memoryContractJournal,
	persistContractRecord,
	type ContractJournalRecord
} from './contract-journal';
import type { ArkSwapContract } from './swap-contract';

const require = createRequire(import.meta.url);
type Expected = { canonical: string } | { error: string };
const v = JSON.parse(readFileSync(require.resolve('@extro/node/vectors/contract_journal.json'), 'utf8')) as {
	canonical: { name: string; record: ContractJournalRecord; expected: Expected }[];
	check: {
		name: string;
		record: ContractJournalRecord;
		contract_address: string;
		amount_sats: string;
		request_commitment_hex: string;
		expected: Expected;
	}[];
};

beforeAll(async () => {
	send = (await bootArkNode()).send;
});

const detail = (e: unknown): string => {
	const m = /ARK_CONTRACT_NOT_PERSISTED: (.*)$/.exec((e as Error).message);
	if (!m) throw e;
	return m[1];
};

async function op(cmd: object): Promise<Expected> {
	const r = await send({ request_id: newRequestId(), op: { kind: 'Exchange', cmd } } as never);
	if (r.kind === 'Ok' && r.body.kind === 'ExchangeJournal') return { canonical: r.body.canonical };
	if (r.kind === 'Err') return { error: detail(new Error(r.message)) };
	throw new Error(`unexpected ${JSON.stringify(r)}`);
}

describe('contract journal: extro-node vector = live Op = wallet', () => {
	it('canonical form and required fields', async () => {
		expect(v.canonical.length).toBeGreaterThan(10);
		for (const c of v.canonical) {
			expect(await op({ op: 'JournalCanonical', record: c.record }), `op: ${c.name}`).toEqual(c.expected);
			const backend = memoryContractJournal();
			let wallet: Expected;
			try {
				await persistContractRecord(backend, c.record);
				wallet = { canonical: backend.map.get(`contract:${c.record.swapId}`)! };
			} catch (e) {
				wallet = { error: detail(e) };
			}
			expect(wallet, `wallet: ${c.name}`).toEqual(c.expected);
		}
	});

	it('funding-gate match', async () => {
		for (const c of v.check) {
			expect(
				await op({
					op: 'JournalCheck',
					record: c.record,
					contract_address: c.contract_address,
					amount_sats: BigInt(c.amount_sats),
					request_commitment_hex: c.request_commitment_hex
				}),
				`op: ${c.name}`
			).toEqual(c.expected);
			const backend = memoryContractJournal();
			backend.map.set(`contract:${c.record.swapId}`, JSON.stringify(c.record));
			const contract = {
				address: c.contract_address,
				plan: { swapId: c.record.swapId, amountSats: BigInt(c.amount_sats) }
			} as unknown as ArkSwapContract;
			let wallet: Expected;
			try {
				const rec = await assertContractPersisted(backend, contract, c.request_commitment_hex);
				wallet = { canonical: JSON.stringify(rec, Object.keys(rec).sort()) };
			} catch (e) {
				wallet = { error: detail(e) };
			}
			expect(wallet, `wallet: ${c.name}`).toEqual(c.expected);
		}
	});
});
