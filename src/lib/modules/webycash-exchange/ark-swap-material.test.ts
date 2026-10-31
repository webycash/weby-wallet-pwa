import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/extro', () => ({ getExtroClient: () => ({ send: vi.fn() }) }));
vi.mock('$lib/extro/release-config', () => ({ getRuntimeConfig: () => ({ ark_enabled: true }) }));

import { verifyProviderMaterialAgainstPlan } from './ark-swap-protocol';
import { fundingRefsFromSpends } from '$lib/ark/settle-tx';
import { TEST_CHECKPOINT_HEX, testSwapContract } from '$lib/ark/settle-tx.fixture';

const locked = `${'33'.repeat(32)}:0`;
const contract = testSwapContract();
const verify = (m: {
	locked_ref: string;
	tx_settle_hash_hex: string;
	tx_refund_hash_hex: string;
}) => verifyProviderMaterialAgainstPlan(m, contract, TEST_CHECKPOINT_HEX);

describe('seller verifies provider material against its own Arkade spends', () => {
	it('accepts material whose [checkpoint, ark] bundles equal the seller-built spends', () => {
		const refs = fundingRefsFromSpends(contract, locked, TEST_CHECKPOINT_HEX);
		expect(refs.txSettleHashHex).toMatch(/^[0-9a-f]{128}$/);
		const out = verify({
			locked_ref: locked,
			tx_settle_hash_hex: refs.txSettleHashHex.toUpperCase(),
			tx_refund_hash_hex: refs.txRefundHashHex
		});
		expect(out.lockedRef).toBe(locked);
		expect(out.settle.bundleHex).toBe(refs.txSettleHashHex);
		expect(out.refund.kind).toBe('refund');
	});

	it('rejects a swapped / foreign settle or refund bundle', () => {
		const refs = fundingRefsFromSpends(contract, locked, TEST_CHECKPOINT_HEX);
		expect(() =>
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txRefundHashHex,
				tx_refund_hash_hex: refs.txSettleHashHex
			})
		).toThrow(/settle sighash/);
		expect(() =>
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txSettleHashHex,
				tx_refund_hash_hex: 'ab'.repeat(64)
			})
		).toThrow(/refund sighash/);
		// the legacy 32-byte template digest is no longer accepted
		expect(() =>
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txSettleHashHex.slice(64),
				tx_refund_hash_hex: refs.txRefundHashHex
			})
		).toThrow(/settle sighash/);
	});

	it('rejects material bound to a different outpoint', () => {
		const refs = fundingRefsFromSpends(contract, `${'44'.repeat(32)}:0`, TEST_CHECKPOINT_HEX);
		expect(() =>
			verify({
				locked_ref: locked,
				tx_settle_hash_hex: refs.txSettleHashHex,
				tx_refund_hash_hex: refs.txRefundHashHex
			})
		).toThrow();
	});
});
