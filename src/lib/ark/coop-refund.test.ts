/**
 * coop-refund-v1 wallet client against a referee simulator that enforces the
 * real referee rules: Ed25519 verify over the exact canonical message by the
 * committed provider cancel key, TTL ≤ 600 s, ONE prepared refund nonce that is
 * consumed once (identical retry → identical partial), real MuSig2 partials.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nonceAggregate, nonceGen } from '@scure/btc-signer/musig2.js';
import { bootArkNode } from './ark-node.testkit';

// The ceremony crypto runs in the real extro-node WASM (Op::Ark).
const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));

import { schnorr } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { fundingRefsFromSpends, splitAggregateBundle } from './settle-tx';
import {
	TEST_PROVIDER_PUB,
	TEST_PROVIDER_SK,
	TEST_REFEREE_PUB,
	TEST_REFEREE_SK,
	testOwnerKey,
	testSigningSession,
	testSwapContract
} from '../../test/fixtures/settle-tx.fixture';
import { coopRefundAggregate, type CoopRefundDeps, type CoopRefundInput } from './coop-refund';

const hx = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const LOCKED = `${'5a'.repeat(32)}:1`;
const COMMIT = 'cd'.repeat(32);
/** The per-swap tweaked owner key of this swap (audit C1). */
const TEST_Q = testOwnerKey('coop-swap', unhex(COMMIT));
let contract: Awaited<ReturnType<typeof testSwapContract>>;
let refs: Awaited<ReturnType<typeof fundingRefsFromSpends>>;
const DEST = 'ark1qprovider';
const CANCEL_SK = new Uint8Array(32).fill(9);
const CANCEL_PK = hx(ed25519.getPublicKey(CANCEL_SK));
const NOW = 1_800_000_000;

type N = ReturnType<typeof nonceGen>;
const gen = (pub: Uint8Array, sk: Uint8Array, h: string): N[] =>
	[0, 1].map((i) => nonceGen(pub, sk, TEST_Q, unhex(h.slice(i * 64, i * 64 + 64))));
const pubHex = (n: N[]) => n.map((x) => hx(x.public)).join('');
function partial(which: 0 | 1, mine: N[], otherPubHex: string, h: string): string {
	const sk = which === 0 ? TEST_REFEREE_SK : TEST_PROVIDER_SK;
	return [0, 1]
		.map((i) => {
			const other = unhex(otherPubHex.slice(i * 132, i * 132 + 132));
			const pubs = which === 0 ? [mine[i].public, other] : [other, mine[i].public];
			const session = testSigningSession(
				nonceAggregate(pubs),
				unhex(h.slice(i * 64, i * 64 + 64)),
				'coop-swap',
				unhex(COMMIT)
			);
			return hx(session.sign(mine[i].secret, sk));
		})
		.join('');
}

/** Referee simulator (same rules as webycash-referee src/api/coop_refund.rs). */
function referee(opts: { phase?: string; amount?: number; dest?: string; commit?: string; tamper?: boolean } = {}) {
	const rn = gen(TEST_REFEREE_PUB, TEST_REFEREE_SK, refs.txRefundHashHex);
	let consumed: { key: string; partial: string } | null = null;
	const seen: string[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		expect(url).toBe('https://ref.test/v1/swap/coop-swap/coop-refund');
		const b = JSON.parse(init.body as string);
		seen.push(b.action);
		const msg = `webycash-referee/coop-refund/v1\ncoop-swap\n${opts.commit ?? COMMIT}\n${b.action}\n${b.tx_refund_sighash_bundle_hex}\n${b.provider_refund_nonce_bundle_hex}\n${b.expires_at_unix}`;
		if (!ed25519.verify(unhex(b.signature_hex), new TextEncoder().encode(msg), unhex(CANCEL_PK)))
			return new Response('coop-refund signature is not by the swap provider', { status: 400 });
		if (b.expires_at_unix <= NOW || b.expires_at_unix > NOW + 600) return new Response('expired', { status: 400 });
		const body: Record<string, unknown> = {
			swap_id: 'coop-swap',
			action: b.action,
			phase: opts.phase ?? 'pre-checked',
			request_commitment_hex: opts.commit ?? COMMIT,
			prepare_terms_b64: 'AA==',
			ark_network: 'bitcoin',
			ark_amount_sats: opts.amount ?? Number(contract.plan.amountSats),
			provider_ark_destination: opts.dest ?? DEST,
			referee_musig2_pubshare_hex: hx(TEST_REFEREE_PUB),
			referee_refund_nonce_bundle_hex: pubHex(rn),
			referee_refund_partial_hex: null
		};
		if (b.action === 'refund') {
			const key = `${b.tx_refund_sighash_bundle_hex}|${b.provider_refund_nonce_bundle_hex}`;
			if (consumed && consumed.key !== key) return new Response('refund session consumed', { status: 409 });
			if (!consumed) consumed = { key, partial: partial(0, rn, b.provider_refund_nonce_bundle_hex, b.tx_refund_sighash_bundle_hex) };
			body.phase = 'canceled';
			body.referee_refund_partial_hex = opts.tamper ? 'ff' + consumed.partial.slice(2) : consumed.partial;
		}
		return new Response(JSON.stringify(body), { status: 200 });
	}) as unknown as typeof fetch;
	return { fetchImpl, seen, consumedKey: () => consumed?.key };
}

/** Provider WASM simulator: per-order cancel key + fresh single-use refund nonce. */
function provider() {
	const live = new Map<string, N[]>();
	const deps: CoopRefundDeps = {
		now: () => NOW,
		randomHex: () => '00'.repeat(16),
		signRequest: async (i) => {
			const msg = `webycash-referee/coop-refund/v1\n${i.swapId}\n${i.requestCommitmentHex}\n${i.action}\n${i.sighashBundleHex}\n${i.nonceBundleHex}\n${i.expiresAtUnix}`;
			return { signatureHex: hx(ed25519.sign(new TextEncoder().encode(msg), CANCEL_SK)), cancelPubkeyHex: CANCEL_PK };
		},
		freshNonce: async ({ fillId }) => {
			expect(fillId.startsWith('coop:coop-swap:')).toBe(true);
			if (live.has(fillId)) throw new Error('live nonce');
			const n = gen(TEST_PROVIDER_PUB, TEST_PROVIDER_SK, refs.txRefundHashHex);
			live.set(fillId, n);
			return { pubkeyHex: hx(TEST_PROVIDER_PUB), refundNonceHex: pubHex(n) };
		},
		sign: async (req) => {
			const n = live.get(req.fillId);
			if (!n) throw new Error('no live nonce');
			live.delete(req.fillId);
			expect(req.session).toBe('refund');
			return partial(1, n, req.refereeNonceHex, hx(req.msg));
		}
	};
	return { deps, live };
}

const input = (over: Partial<CoopRefundInput> = {}): CoopRefundInput => ({
	refereeUrl: 'https://ref.test/',
	swapId: 'coop-swap',
	slot: 0,
	orderIdHex: '11'.repeat(16),
	requestCommitmentHex: COMMIT.toUpperCase(),
	refundHashHex: refs.txRefundHashHex,
	aggregateOwnerKey: TEST_Q,
	expectAmountSats: contract.plan.amountSats,
	expectDestination: DEST,
	expectCancelPubkeyHex: CANCEL_PK,
	...over
});

beforeAll(async () => {
	node.client = await bootArkNode();
	contract = await testSwapContract('coop-swap', unhex(COMMIT));
	refs = await fundingRefsFromSpends(contract, LOCKED);
});

describe('coop-refund-v1 client', () => {
	it('terms → fresh nonce → refund → aggregates a broadcastable refund under Q', async () => {
		const r = referee();
		const p = provider();
		const out = await coopRefundAggregate(input(), { ...p.deps, fetch: r.fetchImpl });
		expect(r.seen).toEqual(['terms', 'refund']);
		expect(out.phase).toBe('canceled');
		expect(p.live.size).toBe(0); // fresh nonce consumed
		const [s0, s1] = splitAggregateBundle(out.signaturesHex);
		expect(schnorr.verify(s0, refs.refund.sighashes[0], TEST_Q)).toBe(true);
		expect(schnorr.verify(s1, refs.refund.sighashes[1], TEST_Q)).toBe(true);
		expect(schnorr.verify(s1, refs.settle.sighashes[1], TEST_Q)).toBe(false);
	});

	it('a second attempt with a new nonce is refused by the referee (nonce never reused)', async () => {
		const r = referee();
		await coopRefundAggregate(input(), { ...provider().deps, fetch: r.fetchImpl });
		const p2 = provider();
		await expect(
			coopRefundAggregate(input(), { ...p2.deps, randomHex: () => '01'.repeat(16), fetch: r.fetchImpl })
		).rejects.toThrow(/ARK_COOP_REFUND_FAILED.*409/);
	});

	it('fails closed on foreign terms, a late phase, a bad partial or a different cancel key', async () => {
		const cases: [Parameters<typeof referee>[0], Partial<CoopRefundInput>, RegExp][] = [
			[{ dest: 'ark1qsomeoneelse' }, {}, /destination/],
			[{ amount: 1 }, {}, /amount/],
			[{ commit: 'ee'.repeat(32) }, {}, /signature is not by the swap provider|commitment/],
			[{ phase: 'inserted' }, {}, /coop-refund window/],
			[{ tamper: true }, {}, /ARK_COOP_REFUND_FAILED/],
			[{}, { expectCancelPubkeyHex: '00'.repeat(32) }, /cancel key differs/],
			[{}, { aggregateOwnerKey: new Uint8Array(32).fill(3) }, /bind to Q/]
		];
		for (const [ro, io, re] of cases) {
			const p = provider();
			await expect(coopRefundAggregate(input(io), { ...p.deps, fetch: referee(ro).fetchImpl })).rejects.toThrow(re);
		}
	});

	it('refuses malformed local inputs before any network call', async () => {
		const p = provider();
		const r = referee();
		await expect(coopRefundAggregate(input({ refundHashHex: 'ab' }), { ...p.deps, fetch: r.fetchImpl })).rejects.toThrow(/sighash/);
		await expect(coopRefundAggregate(input({ orderIdHex: 'zz' }), { ...p.deps, fetch: r.fetchImpl })).rejects.toThrow(/order id/);
		expect(r.seen).toEqual([]);
	});
});
