/**
 * Settle transport: framing, referee push verification (test-only Ed25519 key),
 * webcash hash binding and the default transport's referee pulls, with the
 * extro-node seal/open mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';

const REFEREE_SK = new Uint8Array(32).fill(0x2a); // TEST-ONLY
const REFEREE_VK = ed25519.getPublicKey(REFEREE_SK);
const hx = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
const sha = async (b: Uint8Array) => hx(new Uint8Array(await crypto.subtle.digest('SHA-256', b.slice().buffer)));

const st = vi.hoisted(() => ({
	sends: [] as { op: { kind: string; cmd: Record<string, unknown> } }[],
	opened: new Uint8Array()
}));
vi.mock('$lib/extro/runtime-config', () => ({
	getRuntimeConfig: () => ({
		referee_url: 'https://referee.invalid/',
		referee_vk_hex: hx(REFEREE_VK),
		webcash_server_url: 'https://webcash.invalid',
		ark_asp_url: 'https://asp.invalid'
	})
}));
vi.mock('$lib/extro', () => ({
	getExtroClient: () => ({
		send: async (req: { op: { kind: string; cmd: Record<string, unknown> } }) => {
			st.sends.push(req);
			const op = req.op.cmd.op;
			if (op === 'SealToIdentity' || op === 'SealBearerSecret')
				return { kind: 'Ok', body: { kind: 'Sealed', bytes: new Uint8Array([5, 6, 7]) } };
			if (op === 'OpenSealed') return { kind: 'Ok', body: { kind: 'Opened', bytes: st.opened } };
			if (op === 'SendProviderPartial') return { kind: 'Ok', body: { kind: 'SwapMsgSent', delivered: true } };
			if (op === 'FetchSwapMsgs')
				return {
					kind: 'Ok',
					body: {
						kind: 'SwapMsgs',
						provider: null,
						provider_partial: { locked_ref: LOCKED, sealed: new Uint8Array([5, 6, 7]) }
					}
				};
			throw new Error(`unexpected ${String(op)}`);
		}
	})
}));

import {
	defaultSettleTransport,
	frameConditionalPayload,
	unframeConditionalPayload,
	verifyRefereePush,
	webcashPublicHashHex,
	type RefereePush
} from './ark-settle-transport';

const SWAP = 'swap-1';
const LOCKED = `${'33'.repeat(32)}:0`;
const SELLER = 'ab'.repeat(20);
const PROVIDER = 'cd'.repeat(20);
const CB = 'https://referee.invalid/v1/ack';

async function push(
	kind: RefereePush['kind'],
	recipient: string,
	payload: Uint8Array,
	sk = REFEREE_SK
): Promise<RefereePush> {
	const payloadHash = await sha(payload);
	const body = enc.encode(`webycash-referee/push-v1:${SWAP}:${recipient}:${kind}:${payloadHash}:${CB}`);
	const canonical = enc.encode(`referee:v1:audit-tip:${await sha(body)}`);
	return {
		swap_id: SWAP,
		recipient_fp: recipient,
		kind,
		payload_b64: btoa(String.fromCharCode(...payload)),
		payload_hash_hex: payloadHash,
		callback_url: CB,
		signature_hex: hx(ed25519.sign(canonical, sk))
	};
}

beforeEach(() => {
	st.sends = [];
	st.opened = new Uint8Array();
});

describe('conditional payload framing', () => {
	it('round-trips and rejects bad framing', () => {
		const raw = Uint8Array.from({ length: 100 }, (_, i) => i + 1);
		const framed = frameConditionalPayload(raw);
		expect(framed.length).toBe(128);
		expect(unframeConditionalPayload(framed)).toEqual(raw);
		expect(() => frameConditionalPayload(new Uint8Array(125))).toThrow();
		const bad = framed.slice();
		bad[127] = 1;
		expect(() => unframeConditionalPayload(bad)).toThrow(/trailing/);
	});
});

describe('referee push verification', () => {
	it('accepts a correctly signed push and rejects tampering', async () => {
		const p = await push('release-settle', SELLER, enc.encode('{"x":1}'));
		const want = {
			refereeVkHex: hx(REFEREE_VK),
			swapId: SWAP,
			kind: 'release-settle' as const,
			recipientFpHex: SELLER
		};
		await expect(verifyRefereePush(p, want)).resolves.toEqual(enc.encode('{"x":1}'));
		await expect(verifyRefereePush({ ...p, callback_url: 'https://evil' }, want)).rejects.toThrow(/signature/);
		await expect(verifyRefereePush(p, { ...want, recipientFpHex: PROVIDER })).rejects.toThrow(/different party/);
		await expect(verifyRefereePush(p, { ...want, kind: 'release-refund' })).rejects.toThrow(/kind/);
		await expect(verifyRefereePush({ ...p, payload_b64: btoa('{"x":2}') }, want)).rejects.toThrow(/hash/);
		const forged = await push('release-settle', SELLER, enc.encode('{"x":1}'), new Uint8Array(32).fill(7));
		await expect(verifyRefereePush(forged, want)).rejects.toThrow(/signature/);
	});
});

describe('webcash hash binding', () => {
	it('hashes the ASCII secret hex', async () => {
		const secret = 'ab'.repeat(32);
		expect(await webcashPublicHashHex(`e1.5:secret:${secret}`)).toBe(await sha(enc.encode(secret)));
		await expect(webcashPublicHashHex('e1:public:' + secret)).rejects.toThrow();
	});
});

function fetchStub(routes: Record<string, unknown>) {
	return vi.fn(async (url: string, init?: RequestInit) => {
		const key = `${init?.method ?? 'GET'} ${url}`;
		if (!(key in routes)) return new Response('nope', { status: 404 });
		return new Response(JSON.stringify(routes[key]), { status: 200 });
	}) as unknown as typeof fetch;
}

describe('defaultSettleTransport', () => {
	it('provider: seals the partial to the seller and sends it over DHTX', async () => {
		const t = defaultSettleTransport({ fetchFn: fetchStub({}) });
		await t.deliverProviderPartial!({
			slot: 0,
			orderIdHex: '0f'.repeat(16),
			sellerFpHex: SELLER,
			sellerVkHex: '78'.repeat(32),
			swapId: SWAP,
			lockedRef: LOCKED,
			partialHex: '11'.repeat(64)
		});
		const [seal, send] = st.sends.map((s) => s.op.cmd);
		expect(seal.op).toBe('SealToIdentity');
		expect(new TextDecoder().decode(seal.aad as Uint8Array)).toBe(`webycash/provider-partial/v1|${SWAP}|${LOCKED}`);
		expect(send).toMatchObject({ op: 'SendProviderPartial', locked_ref: LOCKED, sealed: new Uint8Array([5, 6, 7]) });
	});

	it('provider: opens the insert and checks the public hash', async () => {
		const secret = 'cd'.repeat(32);
		const H = await sha(enc.encode(secret));
		st.opened = enc.encode(`e100:secret:${secret}`);
		const insert = {
			recipient_fp: PROVIDER,
			public_hash: H,
			amount: '100',
			enc_secret_for_provider_b64: btoa('sealed')
		};
		const t = defaultSettleTransport({
			fetchFn: fetchStub({ [`GET https://referee.invalid/v1/swap/${SWAP}/insert`]: { phase: 'insert-pushed', insert } })
		});
		await expect(t.awaitProviderOutcome!({ slot: 0, swapId: SWAP, selfFpHex: PROVIDER })).resolves.toEqual({
			kind: 'insert',
			webcash: `e100:secret:${secret}`
		});
		const t2 = defaultSettleTransport({
			fetchFn: fetchStub({
				[`GET https://referee.invalid/v1/swap/${SWAP}/insert`]: {
					phase: 'insert-pushed',
					insert: { ...insert, public_hash: 'ee'.repeat(32) }
				}
			})
		});
		await expect(t2.awaitProviderOutcome!({ slot: 0, swapId: SWAP, selfFpHex: PROVIDER })).rejects.toThrow(
			/public hash/
		);
		await expect(t.awaitProviderOutcome!({ slot: 0, swapId: SWAP, selfFpHex: SELLER })).rejects.toThrow(
			/different provider/
		);
	});

	it('provider: returns the verified ReleaseRefund partial on abort', async () => {
		const partial = '22'.repeat(64);
		const release = await push('release-refund', PROVIDER, enc.encode(partial));
		const t = defaultSettleTransport({
			fetchFn: fetchStub({
				[`GET https://referee.invalid/v1/swap/${SWAP}/insert`]: { phase: 'aborted', insert: null },
				[`GET https://referee.invalid/v1/swap/${SWAP}/release`]: { phase: 'refunded', release }
			})
		});
		await expect(t.awaitProviderOutcome!({ slot: 0, swapId: SWAP, selfFpHex: PROVIDER })).resolves.toEqual({
			kind: 'refund',
			refereePartialHex: partial
		});
	});

	it('seller: verifies ReleaseSettle, unframes and opens provider_enc_partial_sig_b64', async () => {
		const providerPartial = Uint8Array.from({ length: 64 }, (_, i) => i);
		st.opened = providerPartial;
		const framed = frameConditionalPayload(new Uint8Array([5, 6, 7]));
		const payload = enc.encode(
			JSON.stringify({
				referee_partial_sig: '33'.repeat(64),
				provider_enc_partial_sig_b64: btoa(String.fromCharCode(...framed)),
				asp_vtxo_ref: `asp:signet:${LOCKED}:Settle:Spent`
			})
		);
		const release = await push('release-settle', SELLER, payload);
		const t = defaultSettleTransport({
			fetchFn: fetchStub({ [`GET https://referee.invalid/v1/swap/${SWAP}/release`]: { phase: 'settled', release } })
		});
		const out = await t.awaitReleaseSettle!({ slot: 0, swapId: SWAP, lockedRef: LOCKED, selfFpHex: SELLER });
		expect(out?.providerPartialHex).toBe(hx(providerPartial));
		expect(out?.release.refereePartialHex).toBe('33'.repeat(64));
		const open = st.sends.find((s) => s.op.cmd.op === 'OpenSealed')!.op.cmd;
		expect(open.sealed).toEqual(new Uint8Array([5, 6, 7]));
		expect(new TextDecoder().decode(open.aad as Uint8Array)).toBe(`webycash/provider-partial/v1|${SWAP}|${LOCKED}`);
	});

	it('seller: pulls the DHTX provider partial for the funded outpoint only', async () => {
		st.opened = new Uint8Array(64).fill(4);
		const t = defaultSettleTransport({ fetchFn: fetchStub({}) });
		const got = await t.awaitProviderPartial!({
			slot: 0,
			orderIdHex: '0f'.repeat(16),
			swapId: SWAP,
			lockedRef: LOCKED
		});
		expect(got?.partialHex).toBe('04'.repeat(64));
		expect(
			await t.awaitProviderPartial!({
				slot: 0,
				orderIdHex: '0f'.repeat(16),
				swapId: SWAP,
				lockedRef: `${'44'.repeat(32)}:0`
			})
		).toBeNull();
		st.opened = new Uint8Array(10);
		await expect(
			t.awaitProviderPartial!({ slot: 0, orderIdHex: '0f'.repeat(16), swapId: SWAP, lockedRef: LOCKED })
		).rejects.toThrow(/32 bytes/);
	});

	it('seller: bearerSpent reads the webcash health_check', async () => {
		const pub = `e100:public:${'ab'.repeat(32)}`;
		const t = defaultSettleTransport({
			fetchFn: fetchStub({
				'POST https://webcash.invalid/api/v1/health_check': { results: { [pub]: { spent: true } } }
			})
		});
		expect(await t.bearerSpent!(pub)).toBe(true);
		expect(await t.bearerSpent!(`e100:public:${'cd'.repeat(32)}`)).toBe(false);
	});
});
