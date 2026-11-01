import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bootArkNode } from '$lib/ark/ark-node.testkit';

const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));
vi.mock('$lib/extro/release-config', () => ({ getRuntimeConfig: () => ({ ark_enabled: true }) }));

import { verifyProviderMaterialAgainstPlan } from './ark-swap-protocol';
import { fundingRefsFromSpends } from '$lib/ark/settle-tx';
import { testSwapContract } from '$lib/ark/settle-tx.fixture';

const locked = `${'33'.repeat(32)}:0`;
let contract: Awaited<ReturnType<typeof testSwapContract>>;
beforeAll(async () => {
	node.client = await bootArkNode();
	contract = await testSwapContract();
});
const verify = (m: {
	locked_ref: string;
	tx_settle_hash_hex: string;
	tx_refund_hash_hex: string;
}) => verifyProviderMaterialAgainstPlan(m, contract);

describe('seller verifies provider material against its own Arkade spends', async () => {
	it('accepts material whose [checkpoint, ark] bundles equal the seller-built spends', async () => {
		const refs = await fundingRefsFromSpends(contract, locked);
		expect(refs.txSettleHashHex).toMatch(/^[0-9a-f]{128}$/);
		const out = await verify({
			locked_ref: locked,
			tx_settle_hash_hex: refs.txSettleHashHex.toUpperCase(),
			tx_refund_hash_hex: refs.txRefundHashHex
		});
		expect(out.lockedRef).toBe(locked);
		expect(out.settle.bundleHex).toBe(refs.txSettleHashHex);
		expect(out.refund.kind).toBe('refund');
	});

	it('rejects a swapped / foreign settle or refund bundle', async () => {
		const refs = await fundingRefsFromSpends(contract, locked);
		await expect(
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txRefundHashHex,
				tx_refund_hash_hex: refs.txSettleHashHex
			})
		).rejects.toThrow(/settle sighash/);
		await expect(
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txSettleHashHex,
				tx_refund_hash_hex: 'ab'.repeat(64)
			})
		).rejects.toThrow(/refund sighash/);
		// the legacy 32-byte template digest is no longer accepted
		await expect(
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txSettleHashHex.slice(64),
				tx_refund_hash_hex: refs.txRefundHashHex
			})
		).rejects.toThrow(/settle sighash/);
	});

	it('rejects material bound to a different outpoint', async () => {
		const refs = await fundingRefsFromSpends(contract, `${'44'.repeat(32)}:0`);
		await expect(
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txSettleHashHex,
				tx_refund_hash_hex: refs.txRefundHashHex
			})
		).rejects.toThrow();
	});
});
