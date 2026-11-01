/**
 * End-to-end sighash-bundle-v1 ceremony over the REAL Arkade settle/refund
 * spends (test-only scalars): partial bundles verify and aggregate under the
 * per-swap tweaked Q in the real extro-node WASM (`Op::Ark`), and extro-node
 * attaches exactly those signatures to the claim (`SignClaim`), refusing any other.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nonceAggregate, nonceGen } from '@scure/btc-signer/musig2.js';
import { newRequestId } from '@extro/node';
import { bootArkNode } from './ark-node.testkit';

const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));

import { schnorr } from '@noble/curves/secp256k1.js';
import { fundingRefsFromSpends, splitAggregateBundle } from './settle-tx';
import {
	TEST_PROVIDER_PUB,
	TEST_PROVIDER_SK,
	TEST_Q,
	TEST_REFEREE_PUB,
	TEST_REFEREE_SK,
	TEST_REQUEST_COMMITMENT,
	TEST_SWAP_ID,
	testSigningSession,
	testSwapContract
} from '../../test/fixtures/settle-tx.fixture';
import { swapOwnerKey } from './ceremony';
import {
	providerAggregateRefund,
	refundCeremonyInputs,
	sellerAggregateSettle,
	settleCeremonyInputs
} from './settle-step';

const hx = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const LOCKED = `${'5a'.repeat(32)}:1`;
let refs: Awaited<ReturnType<typeof fundingRefsFromSpends>>;
const swap = { swapId: TEST_SWAP_ID, requestCommitment: TEST_REQUEST_COMMITMENT };

/** Per-message nonces for one signer over the 2-message bundle. */
function nonces(pub: Uint8Array, sk: Uint8Array, bundleHex: string) {
	return [0, 1].map((i) => nonceGen(pub, sk, TEST_Q, unhex(bundleHex.slice(i * 64, i * 64 + 64))));
}
function partials(
	which: 0 | 1,
	mine: ReturnType<typeof nonces>,
	other: ReturnType<typeof nonces>,
	bundleHex: string
): string {
	const sk = which === 0 ? TEST_REFEREE_SK : TEST_PROVIDER_SK;
	return [0, 1]
		.map((i) => {
			const pubs = which === 0 ? [mine[i].public, other[i].public] : [other[i].public, mine[i].public];
			const s = testSigningSession(
				nonceAggregate(pubs),
				unhex(bundleHex.slice(i * 64, i * 64 + 64)),
				TEST_SWAP_ID,
				TEST_REQUEST_COMMITMENT
			);
			return hx(s.sign(mine[i].secret, sk));
		})
		.join('');
}
const pubHex = (n: ReturnType<typeof nonces>) => n.map((x) => hx(x.public)).join('');

beforeAll(async () => {
	node.client = await bootArkNode();
	refs = await fundingRefsFromSpends(await testSwapContract(), LOCKED);
});

const signClaim = (kind: 'Settle' | 'Refund', signatures_hex: string) =>
	(node.client as Awaited<ReturnType<typeof bootArkNode>>).send({
		request_id: newRequestId(),
		op: { kind: 'Ark', cmd: { op: 'SignClaim', claims: refs.settle.claims, kind, signatures_hex } }
	});

describe('sighash-bundle-v1 over real Arkade spends', () => {
	it('the simulated signers\' tweaked Q is the extro-node SwapOwnerKey (C1)', async () => {
		await expect(
			swapOwnerKey({ refereePubkeyHex: hx(TEST_REFEREE_PUB), providerPubkeyHex: hx(TEST_PROVIDER_PUB), ...swap })
		).resolves.toEqual(TEST_Q);
	});

	it('settle: seller aggregates both partial bundles into broadcastable signatures', async () => {
		const rn = nonces(TEST_REFEREE_PUB, TEST_REFEREE_SK, refs.txSettleHashHex);
		const pn = nonces(TEST_PROVIDER_PUB, TEST_PROVIDER_SK, refs.txSettleHashHex);
		const inputs = await settleCeremonyInputs({
			prepared: { refereeMusig2Pubshare: hx(TEST_REFEREE_PUB), refereeSettleNoncePub: pubHex(rn) },
			material: {
				provider_musig2_pubkey: hx(TEST_PROVIDER_PUB),
				settle_nonce_pub: pubHex(pn),
				locked_ref: LOCKED,
				tx_settle_hash_hex: refs.txSettleHashHex
			},
			swap,
			lockedRef: LOCKED,
			settleHashHex: refs.txSettleHashHex,
			aggregateOwnerKey: TEST_Q
		} as never);
		const sigs = await sellerAggregateSettle({
			inputs,
			release: {
				refereePartialHex: partials(0, rn, pn, refs.txSettleHashHex),
				providerEncPartialB64: 'AA==',
				aspVtxoRef: `asp:signet:${LOCKED}:Settle:Unspent`
			},
			providerPartialHex: partials(1, pn, rn, refs.txSettleHashHex),
			lockedRef: LOCKED
		});
		const [s0, s1] = splitAggregateBundle(sigs);
		expect(schnorr.verify(s0, refs.settle.sighashes[0], TEST_Q)).toBe(true);
		expect(schnorr.verify(s1, refs.settle.sighashes[1], TEST_Q)).toBe(true);
		const signed = await signClaim('Settle', sigs);
		expect(signed.kind === 'Ok' && signed.body.kind).toBe('ArkSignedClaim');
		// extro-node refuses the swapped pair and the same pair on the refund claim
		const swapped = await signClaim('Settle', hx(s1) + hx(s0));
		expect(swapped.kind).toBe('Err');
		expect((await signClaim('Refund', sigs)).kind).toBe('Err');
		// the same signatures never authorize the refund spend
		expect(schnorr.verify(s1, refs.refund.sighashes[1], TEST_Q)).toBe(false);
	});

	it('refund: provider verifies the referee partial, signs with the refund nonce and aggregates', async () => {
		const rn = nonces(TEST_REFEREE_PUB, TEST_REFEREE_SK, refs.txRefundHashHex);
		const pn = nonces(TEST_PROVIDER_PUB, TEST_PROVIDER_SK, refs.txRefundHashHex);
		const inputs = await refundCeremonyInputs({
			prepared: { refereeMusig2Pubshare: hx(TEST_REFEREE_PUB), refereeRefundNoncePub: pubHex(rn) },
			material: {
				provider_musig2_pubkey: hx(TEST_PROVIDER_PUB),
				refund_nonce_pub: pubHex(pn),
				locked_ref: LOCKED,
				tx_refund_hash_hex: refs.txRefundHashHex
			},
			swap,
			lockedRef: LOCKED,
			refundHashHex: refs.txRefundHashHex,
			aggregateOwnerKey: TEST_Q
		});
		let session = '';
		const sigs = await providerAggregateRefund({
			slot: 0,
			orderIdHex: '11'.repeat(16),
			counterpartyFpHex: '22'.repeat(20),
			inputs,
			refereePartialHex: partials(0, rn, pn, refs.txRefundHashHex),
			sign: async (req) => {
				session = req.session;
				expect(hx(req.msg)).toBe(refs.txRefundHashHex);
				return partials(1, pn, rn, refs.txRefundHashHex);
			}
		});
		expect(session).toBe('refund');
		const [s0, s1] = splitAggregateBundle(sigs);
		expect(schnorr.verify(s0, refs.refund.sighashes[0], TEST_Q)).toBe(true);
		expect(schnorr.verify(s1, refs.refund.sighashes[1], TEST_Q)).toBe(true);
	});

	it('refund: rejects a referee partial over the settle bundle', async () => {
		const rn = nonces(TEST_REFEREE_PUB, TEST_REFEREE_SK, refs.txRefundHashHex);
		const pn = nonces(TEST_PROVIDER_PUB, TEST_PROVIDER_SK, refs.txRefundHashHex);
		const inputs = await refundCeremonyInputs({
			prepared: { refereeMusig2Pubshare: hx(TEST_REFEREE_PUB), refereeRefundNoncePub: pubHex(rn) },
			material: {
				provider_musig2_pubkey: hx(TEST_PROVIDER_PUB),
				refund_nonce_pub: pubHex(pn),
				locked_ref: LOCKED,
				tx_refund_hash_hex: refs.txRefundHashHex
			},
			swap,
			lockedRef: LOCKED,
			refundHashHex: refs.txRefundHashHex,
			aggregateOwnerKey: TEST_Q
		});
		const wrong = partials(
			0,
			nonces(TEST_REFEREE_PUB, TEST_REFEREE_SK, refs.txSettleHashHex),
			pn,
			refs.txSettleHashHex
		);
		await expect(
			providerAggregateRefund({
				slot: 0,
				orderIdHex: '11'.repeat(16),
				counterpartyFpHex: '22'.repeat(20),
				inputs,
				refereePartialHex: wrong,
				sign: async () => {
					throw new Error('must not sign');
				}
			})
		).rejects.toThrow(/referee partial/);
	});
});
