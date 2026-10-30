import { describe, expect, it, vi } from 'vitest';
import { assertFundedLockedRef, resolveFundedLockedRef } from './funded-ref';
import { fixturePlan } from './blocker3-fixture';
import type { ArkSwapContract } from './swap-contract';

const contract = { plan: fixturePlan(), pkScriptHex: '5120' + 'ab'.repeat(32) } as unknown as ArkSwapContract;
const tx = 'cd'.repeat(32);
const reader = (vtxos: unknown[]) => ({ getVtxos: vi.fn(async () => ({ vtxos })) }) as never;

describe('funded locked_ref resolution', () => {
	it('resolves the single unspent contract VTXO of the funding tx', async () => {
		const r = reader([
			{ txid: tx, vout: 0, value: 500, isSpent: false },
			{ txid: tx, vout: 2, value: 1000, isSpent: false, script: contract.pkScriptHex },
			{ txid: 'ee'.repeat(32), vout: 0, value: 1000 }
		]);
		await expect(resolveFundedLockedRef(r, contract, tx.toUpperCase(), { attempts: 1 })).resolves.toBe(`${tx}:2`);
	});

	it('fails closed on zero / ambiguous / spent matches', async () => {
		await expect(resolveFundedLockedRef(reader([]), contract, tx, { attempts: 2, intervalMs: 1 })).rejects.toThrow(/0 contract VTXOs/);
		await expect(
			resolveFundedLockedRef(reader([{ txid: tx, vout: 0, value: 1000 }, { txid: tx, vout: 1, value: 1000 }]), contract, tx, { attempts: 1 })
		).rejects.toThrow(/2 contract VTXOs/);
		await expect(
			resolveFundedLockedRef(reader([{ txid: tx, vout: 0, value: 1000, isSpent: true }]), contract, tx, { attempts: 1 })
		).rejects.toThrow();
	});

	it('seller check requires exact outpoint, amount and script', async () => {
		const good = reader([{ txid: tx, vout: 1, value: 1000, script: contract.pkScriptHex }]);
		await expect(assertFundedLockedRef(good, contract, `${tx}:1`)).resolves.toBeUndefined();
		await expect(assertFundedLockedRef(good, contract, `${tx}:0`)).rejects.toThrow();
		await expect(assertFundedLockedRef(reader([{ txid: tx, vout: 1, value: 999 }]), contract, `${tx}:1`)).rejects.toThrow();
		await expect(
			assertFundedLockedRef(reader([{ txid: tx, vout: 1, value: 1000, script: '5120' + '00'.repeat(32) }]), contract, `${tx}:1`)
		).rejects.toThrow();
		await expect(assertFundedLockedRef(good, contract, 'offer:tark1x')).rejects.toThrow(/txid:vout/);
	});
});
