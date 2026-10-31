/**
 * Settle-step wiring over the thin `Op::Ark` ceremony: the real extro-node
 * WASM and the per-swap tweaked cross-backend vector (audit C1). Ported from
 * the untweaked `settle-ceremony` suite (ADR-0007, H2).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { arkCeremonyVector, bootArkNode } from './ark-node.testkit';

const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));

import type { CeremonyInputs } from './ceremony';
import {
	assertOwnerKeyBinding,
	providerSignSettle,
	sellerAggregateSettle,
	settleCeremonyInputs,
	type ProviderPartialSigner
} from './settle-step';

const V = arkCeremonyVector();
const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const flip = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);
const LOCKED = `${'ab'.repeat(32)}:0`;
const Q = hex(V.owner_q_xonly_hex);
const swap = { swapId: V.swap_id, requestCommitment: hex(V.request_commitment_hex) };
const prepared = { refereeMusig2Pubshare: V.referee_pubkey_hex, refereeSettleNoncePub: V.referee_nonces_hex };
const material = {
	provider_musig2_pubkey: V.provider_pubkey_hex,
	settle_nonce_pub: V.provider_nonces_hex,
	locked_ref: LOCKED,
	tx_settle_hash_hex: V.sighashes_hex
};
const build = (over: Partial<Parameters<typeof settleCeremonyInputs>[0]> = {}) =>
	settleCeremonyInputs({
		prepared,
		material,
		swap,
		lockedRef: LOCKED,
		settleHashHex: V.sighashes_hex,
		aggregateOwnerKey: Q,
		...over
	});

beforeAll(async () => {
	node.client = await bootArkNode();
});

describe('settle step wiring (Op::Ark, tweaked vector)', () => {
	it('binds prepared + material + swap to the tweaked Q', async () => {
		const want: CeremonyInputs = {
			refereePubkeyHex: V.referee_pubkey_hex,
			providerPubkeyHex: V.provider_pubkey_hex,
			swapId: V.swap_id,
			requestCommitment: hex(V.request_commitment_hex),
			refereeNonceHex: V.referee_nonces_hex,
			providerNonceHex: V.provider_nonces_hex,
			sighashHex: V.sighashes_hex
		};
		await expect(build()).resolves.toEqual(want);
		await expect(
			assertOwnerKeyBinding({
				refereePubkeyHex: V.referee_pubkey_hex,
				providerPubkeyHex: V.provider_pubkey_hex,
				swap,
				aggregateOwnerKey: Q
			})
		).resolves.toBeUndefined();
	});

	it('refuses material for another outpoint / sighash, a wrong Q, or another swap binding', async () => {
		await expect(build({ lockedRef: `${'cd'.repeat(32)}:0` })).rejects.toThrow(
			/ARK_SETTLE_CEREMONY_INVALID.*locked_ref/
		);
		await expect(build({ settleHashHex: 'a5'.repeat(64) })).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID.*settle hash/);
		await expect(build({ aggregateOwnerKey: hex('22'.repeat(32)) })).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
		// C1: the same keys under another swap id / request commitment are another Q
		await expect(build({ swap: { ...swap, swapId: `${V.swap_id}-other` } })).rejects.toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		await expect(build({ swap: { ...swap, requestCommitment: new Uint8Array(32).fill(0x5d) } })).rejects.toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
	});

	it('provider signs via the WASM op with the extro-node fill id + swap binding and self-verifies', async () => {
		const sign = vi.fn(async (_input: Parameters<ProviderPartialSigner>[0]) => V.provider_partials_hex);
		const orderIdHex = '0f'.repeat(16);
		await expect(
			providerSignSettle({ slot: 3, orderIdHex, counterpartyFpHex: 'AB'.repeat(20), inputs: await build(), sign })
		).resolves.toBe(V.provider_partials_hex);
		const arg = sign.mock.calls[0][0];
		expect(arg).toMatchObject({
			slot: 3,
			fillId: `${orderIdHex}:${'ab'.repeat(20)}`,
			session: 'settle',
			refereePkHex: V.referee_pubkey_hex,
			refereeNonceHex: V.referee_nonces_hex,
			swapId: V.swap_id
		});
		expect(Array.from(arg.requestCommitment)).toEqual(Array.from(hex(V.request_commitment_hex)));
		expect(Array.from(arg.msg)).toEqual(Array.from(hex(V.sighashes_hex)));
	});

	it('provider refuses a WASM partial that does not verify', async () => {
		const inputs = await build();
		for (const bad of [flip(V.provider_partials_hex), V.referee_partials_hex]) {
			await expect(
				providerSignSettle({
					slot: 0,
					orderIdHex: '0f'.repeat(16),
					counterpartyFpHex: 'ab'.repeat(20),
					inputs,
					sign: async () => bad
				})
			).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
		}
	});

	it('seller aggregates a ReleaseSettle for its own VTXO and refuses a foreign one', async () => {
		const inputs = await build();
		const release = { refereePartialHex: V.referee_partials_hex, providerEncPartialB64: 'AAEC', aspVtxoRef: LOCKED };
		await expect(
			sellerAggregateSettle({ inputs, release, providerPartialHex: V.provider_partials_hex, lockedRef: LOCKED })
		).resolves.toBe(V.signatures_hex.join(''));
		await expect(
			sellerAggregateSettle({
				inputs,
				release: { ...release, aspVtxoRef: `${'cd'.repeat(32)}:1` },
				providerPartialHex: V.provider_partials_hex,
				lockedRef: LOCKED
			})
		).rejects.toThrow(/different VTXO/);
	});
});
