/**
 * Ark settle/refund claims built in the real extro-node WASM (`Op::Ark`) vs
 * the Arkade SDK, with test-only keys: MuSig2-aggregate [referee, provider]
 * under the per-swap tweaked Q over the [checkpoint, ark] bundle, let
 * extro-node attach the signatures, and check the SDK's own
 * `verifyTapscriptSignatures` accepts the PSBTs `submitArkSpend` submits.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ArkAddress, Transaction, verifyTapscriptSignatures } from '@arkade-os/sdk';
import { SigHash } from '@scure/btc-signer';
import { tapLeafHash } from '@scure/btc-signer/payment.js';
import { base64 } from '@scure/base';
import { nonceAggregate, nonceGen } from '@scure/btc-signer/musig2.js';
import { bootArkNode } from './ark-node.testkit';

const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));

import {
	SIGHASH_BUNDLE_TAG,
	fundingRefsFromSpends,
	sighashBundleBinding,
	submitArkSpend,
	type ArkSpend
} from './settle-tx';
import type { ArkSwapContract } from './swap-contract';
import {
	TEST_OPERATOR_X,
	TEST_PROVIDER_PUB,
	TEST_PROVIDER_SK,
	TEST_Q,
	TEST_REFEREE_PUB,
	TEST_REFEREE_SK,
	TEST_REQUEST_COMMITMENT,
	TEST_SWAP_ID,
	testScalar,
	testSigningSession,
	testSwapContract
} from './settle-tx.fixture';

const hx = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const OPERATOR = testScalar(3);
const LOCKED = `${'5a'.repeat(32)}:1`;
let contract: ArkSwapContract;
let refs: Awaited<ReturnType<typeof fundingRefsFromSpends>>;

beforeAll(async () => {
	node.client = await bootArkNode();
	contract = await testSwapContract();
	refs = await fundingRefsFromSpends(contract, LOCKED);
});

function musigSign(msg: Uint8Array): Uint8Array {
	const rn = nonceGen(TEST_REFEREE_PUB, TEST_REFEREE_SK, TEST_Q, msg);
	const pn = nonceGen(TEST_PROVIDER_PUB, TEST_PROVIDER_SK, TEST_Q, msg);
	const s = testSigningSession(nonceAggregate([rn.public, pn.public]), msg, TEST_SWAP_ID, TEST_REQUEST_COMMITMENT);
	return s.partialSigAgg([s.sign(rn.secret, TEST_REFEREE_SK), s.sign(pn.secret, TEST_PROVIDER_SK)]);
}
const aggregate = (s: ArkSpend) => s.sighashes.map(musigSign).map(hx).join('');
const leafHashOf = (tx: Transaction) => {
	const [[, withVersion]] = tx.getInput(0).tapLeafScript!;
	return tapLeafHash(withVersion.subarray(0, -1), withVersion[withVersion.length - 1]);
};

/** A fake ASP that co-signs as the test operator (or misbehaves on request). */
function fakeAsp(opts: { wrongTxid?: boolean; unsignedCheckpoint?: boolean } = {}) {
	const seen = { submitted: null as Transaction | null, finalized: [] as string[], finalizeCalls: 0 };
	return {
		seen,
		provider: {
			async submitTx(signedArkTx: string, checkpointTxs: string[]) {
				const ark = Transaction.fromPSBT(base64.decode(signedArkTx));
				seen.submitted = ark;
				const cps = checkpointTxs.map((c) => {
					const t = Transaction.fromPSBT(base64.decode(c));
					if (!opts.unsignedCheckpoint) t.signIdx(OPERATOR, 0);
					return base64.encode(t.toPSBT());
				});
				return { arkTxid: opts.wrongTxid ? 'ab'.repeat(32) : ark.id, signedCheckpointTxs: cps };
			},
			async finalizeTx(_id: string, cps: string[]) {
				seen.finalizeCalls += 1;
				seen.finalized = cps;
			}
		}
	};
}

describe('Ark settle/refund claims (extro-node Op::Ark)', () => {
	it('is deterministic and distinct per path and per tx', async () => {
		const again = await fundingRefsFromSpends(contract, LOCKED);
		expect(again.txSettleHashHex).toBe(refs.txSettleHashHex);
		expect(refs.txSettleHashHex).toMatch(/^[0-9a-f]{128}$/);
		expect(hx(refs.settle.sighashes[0])).not.toBe(hx(refs.settle.sighashes[1]));
		expect(refs.txSettleHashHex).not.toBe(refs.txRefundHashHex);
		expect(refs.settle.destination).toBe(contract.plan.bearerSellerDestination);
		expect(refs.refund.destination).toBe(contract.plan.providerDestination);
	});

	it('sighash-bundle-v1 binding matches SHA256(tag || checkpoint || ark)', async () => {
		const bundle = Uint8Array.from(Buffer.from(refs.txSettleHashHex, 'hex'));
		const want = createHash('sha256').update(SIGHASH_BUNDLE_TAG).update(bundle).digest();
		expect(hx(await sighashBundleBinding(bundle))).toBe(hx(want));
	});

	it('submits PSBTs the SDK verifier accepts, and finalizes the operator-signed checkpoint', async () => {
		const { seen, provider } = fakeAsp();
		const txid = await submitArkSpend({ spend: refs.settle, aggregateSigsHex: aggregate(refs.settle), provider });
		const ark = seen.submitted!;
		expect(txid).toBe(ark.id);
		const leaf = leafHashOf(ark);
		verifyTapscriptSignatures(ark, 0, [hx(TEST_Q)], [hx(TEST_OPERATOR_X)], [SigHash.DEFAULT], leaf);
		expect(hx(ark.getOutput(0).script!)).toBe(hx(ArkAddress.decode(contract.plan.bearerSellerDestination).pkScript));
		expect(seen.finalized).toHaveLength(1);
		const cp = Transaction.fromPSBT(base64.decode(seen.finalized[0]));
		expect(hx(cp.getInput(0).txid!)).toBe('5a'.repeat(32));
		expect(cp.getInput(0).index).toBe(1);
		expect(hx(ark.getInput(0).txid!)).toBe(cp.id);
		verifyTapscriptSignatures(cp, 0, [hx(TEST_Q), hx(TEST_OPERATOR_X)], [], [SigHash.DEFAULT], leaf);
	});

	it('refuses swapped or cross-path signatures before contacting the operator', async () => {
		const { seen, provider } = fakeAsp();
		const sigs = aggregate(refs.settle);
		await expect(
			submitArkSpend({ spend: refs.settle, aggregateSigsHex: sigs.slice(128) + sigs.slice(0, 128), provider })
		).rejects.toThrow(/SignClaim/);
		await expect(submitArkSpend({ spend: refs.refund, aggregateSigsHex: sigs, provider })).rejects.toThrow(/SignClaim/);
		expect(seen.submitted).toBeNull();
	});

	it('fails closed on a substituted ark txid or an operator-unsigned checkpoint', async () => {
		const sigs = aggregate(refs.refund);
		const wrong = fakeAsp({ wrongTxid: true });
		await expect(submitArkSpend({ spend: refs.refund, aggregateSigsHex: sigs, provider: wrong.provider })).rejects.toThrow(
			/different ark transaction/
		);
		const unsigned = fakeAsp({ unsignedCheckpoint: true });
		await expect(
			submitArkSpend({ spend: refs.refund, aggregateSigsHex: sigs, provider: unsigned.provider })
		).rejects.toThrow(/CosignCheckpoint/);
		expect(wrong.seen.finalizeCalls + unsigned.seen.finalizeCalls).toBe(0);
	});
});
