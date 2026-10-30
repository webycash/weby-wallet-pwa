import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/extro', () => ({ getExtroClient: () => ({ send: vi.fn() }) }));
vi.mock('$lib/extro/runtime-config', () => ({ getRuntimeConfig: () => ({ ark_enabled: true }) }));

import { verifyProviderMaterialAgainstPlan } from './ark-swap-protocol';
import { fundingRefsFromTemplates } from '$lib/ark/provider-material';
import { fixturePlan } from '$lib/ark/blocker3-fixture';

const locked = `${'33'.repeat(32)}:0`;

describe('seller verifies provider material against its own templates', () => {
	it('accepts material whose hashes equal the seller-derived templates', async () => {
		const refs = await fundingRefsFromTemplates(fixturePlan(), locked);
		const out = await verifyProviderMaterialAgainstPlan(
			{ locked_ref: locked, tx_settle_hash_hex: refs.txSettleHashHex.toUpperCase(), tx_refund_hash_hex: refs.txRefundHashHex },
			fixturePlan()
		);
		expect(out.lockedRef).toBe(locked);
	});

	it('rejects a swapped / foreign settle or refund hash', async () => {
		const refs = await fundingRefsFromTemplates(fixturePlan(), locked);
		await expect(
			verifyProviderMaterialAgainstPlan(
				{ locked_ref: locked, tx_settle_hash_hex: refs.txRefundHashHex, tx_refund_hash_hex: refs.txSettleHashHex },
				fixturePlan()
			)
		).rejects.toThrow(/settle template hash/);
		await expect(
			verifyProviderMaterialAgainstPlan(
				{ locked_ref: locked, tx_settle_hash_hex: refs.txSettleHashHex, tx_refund_hash_hex: 'ab'.repeat(32) },
				fixturePlan()
			)
		).rejects.toThrow(/refund template hash/);
	});

	it('rejects material bound to a different outpoint', async () => {
		const refs = await fundingRefsFromTemplates(fixturePlan(), `${'44'.repeat(32)}:0`);
		await expect(
			verifyProviderMaterialAgainstPlan(
				{ locked_ref: locked, tx_settle_hash_hex: refs.txSettleHashHex, tx_refund_hash_hex: refs.txRefundHashHex },
				fixturePlan()
			)
		).rejects.toThrow();
	});
});
