import { describe, expect, it } from 'vitest';
import {
	GATE_REFUND_SIGNER_PENDING,
	GATE_SETTLE_SIGNER_PENDING,
	NamedArkGateError
} from './named-gates';
import {
	buildRefundTemplate,
	buildSettleTemplate,
	canonicalSpendTemplateBytes,
	signRefundRecovery,
	signSettlePartial
} from './swap-spend';
import type { VerifiedArkContractPlan } from './swap-contract';

const hex = (value: string): Uint8Array =>
	Uint8Array.from({ length: value.length / 2 }, (_, i) => Number.parseInt(value.slice(i * 2, i * 2 + 2), 16));

const plan = (): VerifiedArkContractPlan => ({
	swapId: 'swap-spend-fixture',
	requestCommitment: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
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

const locked = `${'ab'.repeat(32)}:1`;

describe('Ark settle/refund templates', () => {
	it('builds deterministic settle and refund digests with distinct leaves', async () => {
		const settleA = await buildSettleTemplate(plan(), locked);
		const settleB = await buildSettleTemplate(plan(), locked);
		const refund = await buildRefundTemplate(plan(), locked);
		expect(settleA.templateDigestHex).toBe(settleB.templateDigestHex);
		expect(settleA.leaf).toBe('collaborative-settle');
		expect(settleA.destination).toBe('tark1seller');
		expect(refund.leaf).toBe('provider-csv-refund');
		expect(refund.destination).toBe('tark1provider');
		expect(settleA.templateDigestHex).not.toBe(refund.templateDigestHex);
		expect(settleA.lockedRef).toBe(locked);
	});

	it('canonical bytes are stable and reject malformed locked_ref', async () => {
		const settle = await buildSettleTemplate(plan(), locked);
		const again = canonicalSpendTemplateBytes({
			leaf: settle.leaf,
			lockedRef: settle.lockedRef,
			amountSats: settle.amountSats,
			destination: settle.destination,
			network: settle.network,
			swapId: settle.swapId,
			requestCommitmentHex: settle.requestCommitmentHex,
			aggregateOwnerKeyHex: settle.aggregateOwnerKeyHex,
			providerRecoveryKeyHex: settle.providerRecoveryKeyHex,
			operatorSignerKeyHex: settle.operatorSignerKeyHex,
			unilateralExitDelay: settle.unilateralExitDelay
		});
		expect(new TextDecoder().decode(again)).toContain('leaf=collaborative-settle');
		await expect(buildSettleTemplate(plan(), 'not-an-outpoint')).rejects.toThrow(/txid:vout/);
	});

	it('dedicated signers fail closed with named gates (no fake hashes)', async () => {
		const settle = await buildSettleTemplate(plan(), locked);
		const refund = await buildRefundTemplate(plan(), locked);
		await expect(signSettlePartial(settle)).rejects.toBeInstanceOf(NamedArkGateError);
		await expect(signSettlePartial(settle)).rejects.toThrow(GATE_SETTLE_SIGNER_PENDING);
		await expect(signRefundRecovery(refund)).rejects.toThrow(GATE_REFUND_SIGNER_PENDING);
	});
});
