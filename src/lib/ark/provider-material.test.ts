import { describe, expect, it } from 'vitest';
import {
	assembleProviderMaterial,
	exactLockedRef,
	exactTxHashHex,
	fundingRefsFromTemplates
} from './provider-material';
import {
	buildRefundTemplate,
	buildSettleTemplate,
	setDedicatedCosignBackend,
	signRefundRecovery,
	signSettlePartial
} from './swap-spend';
import { GATE_SETTLE_SIGNER_PENDING, NamedArkGateError } from './named-gates';
import type { VerifiedArkContractPlan } from './swap-contract';

const hex = (value: string): Uint8Array =>
	Uint8Array.from({ length: value.length / 2 }, (_, i) => Number.parseInt(value.slice(i * 2, i * 2 + 2), 16));

const plan = (): VerifiedArkContractPlan => ({
	swapId: 'pm-fixture',
	requestCommitment: Uint8Array.from({ length: 32 }, (_, i) => i + 3),
	aggregateOwnerKey: hex('f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'),
	providerRecoveryKey: hex('c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'),
	operatorSignerKey: hex('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
	operatorInfoDigest: new Uint8Array(32).fill(0x62),
	unilateralExitDelay: 86_016n,
	amountSats: 25_000n,
	network: 'signet',
	providerDestination: 'tark1provider',
	bearerSellerDestination: 'tark1seller',
	expiresAtUnix: 4_000_000_000n
});

const locked = `${'11'.repeat(32)}:0`;

describe('ProviderMaterial assemble (Gate 3)', () => {
	it('binds genuine locked_ref + distinct settle/refund template digests', async () => {
		const refs = await fundingRefsFromTemplates(plan(), locked);
		expect(refs.lockedRef).toBe(locked);
		expect(refs.txSettleHashHex).not.toBe(refs.txRefundHashHex);
		expect(refs.txSettleHashHex).not.toMatch(/^(ab){32}$/);
		const material = assembleProviderMaterial({
			orderId: new Uint8Array(16).fill(7),
			providerFp: new Uint8Array(20).fill(8),
			providerPgpPubkey: new Uint8Array(32).fill(9),
			providerMusig2Pubkey: '02' + 'aa'.repeat(32),
			settleNoncePub: 'bb'.repeat(66),
			refundNoncePub: 'cc'.repeat(66),
			providerCancelPubkeyHex: 'dd'.repeat(32),
			funding: refs
		});
		expect(material.locked_ref).toBe(locked);
		expect(material.tx_settle_hash_hex).toBe(refs.txSettleHashHex);
		expect(material.tx_refund_hash_hex).toBe(refs.txRefundHashHex);
	});

	it('rejects placeholder locked_ref and ab/cf hashes', () => {
		expect(() => exactLockedRef('v'.repeat(64))).toThrow(/placeholder/);
		expect(() => exactLockedRef('ark:vtxo:owner:asp:100')).toThrow(/placeholder/);
		expect(() => exactTxHashHex('ab'.repeat(32), 'tx_settle_hash')).toThrow(/placeholder/);
		expect(() => exactTxHashHex('cf'.repeat(32), 'tx_refund_hash')).toThrow(/placeholder/);
	});

	it('injected cosign backend returns receipts; default stays named-gated', async () => {
		const settle = await buildSettleTemplate(plan(), locked);
		const refund = await buildRefundTemplate(plan(), locked);
		await expect(signSettlePartial(settle)).rejects.toBeInstanceOf(NamedArkGateError);
		await expect(signSettlePartial(settle)).rejects.toThrow(GATE_SETTLE_SIGNER_PENDING);

		setDedicatedCosignBackend({
			async signSettle(t) {
				return { signatureHex: `ee${t.templateDigestHex}`, aspRef: 'asp:signet:test:Present' };
			},
			async signRefund(t) {
				return { signatureHex: `ff${t.templateDigestHex}` };
			}
		});
		try {
			const s = await signSettlePartial(settle);
			const r = await signRefundRecovery(refund);
			expect(s.signatureHex.startsWith('ee')).toBe(true);
			expect(r.signatureHex.startsWith('ff')).toBe(true);
			expect(s.aspRef).toContain('signet');
		} finally {
			setDedicatedCosignBackend(null);
		}
	});
});
