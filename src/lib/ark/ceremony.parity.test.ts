/**
 * Parity gate for the H2 port (ADR-0007): the old in-TS ceremony
 * (`settle-ceremony.ts`, @scure musig2) against extro-node's `Op::Ark` on the
 * same vectors, before callers switch. Where the two must agree they are
 * asserted equal; where they intentionally differ (the C1 per-swap tweak the
 * old TS never had) the divergence is asserted explicitly, so it can't be
 * mistaken for a regression.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { arkCeremonyVector, bootArkNode } from './ark-node.testkit';
import untweaked from './settle-ceremony.vector.json';

const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));

import * as next from './ceremony';
import * as old from './settle-ceremony';

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const v = arkCeremonyVector();
const tweaked: next.CeremonyInputs = {
	refereePubkeyHex: v.referee_pubkey_hex,
	providerPubkeyHex: v.provider_pubkey_hex,
	swapId: v.swap_id,
	requestCommitment: hex(v.request_commitment_hex),
	refereeNonceHex: v.referee_nonces_hex,
	providerNonceHex: v.provider_nonces_hex,
	sighashHex: v.sighashes_hex
};
const flip = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);

beforeAll(async () => {
	node.client = await bootArkNode();
});

describe('ceremony parity: settle-ceremony.ts (old TS) vs Op::Ark', () => {
	it('wire-shape helpers agree', () => {
		for (const [h, unit] of [
			[v.sighashes_hex, 32],
			[v.referee_nonces_hex, 66],
			[v.referee_partials_hex, 32],
			['ab'.repeat(33), 32],
			['zz', 1],
			['', 32]
		] as const) {
			expect(next.bundleCount(h, unit)).toBe(old.bundleCount(h, unit));
		}
		const ref = `${'ab'.repeat(32)}:0`;
		for (const asp of [ref, 'asp-unverified:timeout', `asp:signet:${ref}:tx:obs`, `asp:${'cd'.repeat(32)}:0`]) {
			expect(next.releaseNamesLockedRef(asp, ref)).toBe(old.releaseNamesLockedRef(asp, ref));
		}
		const body = JSON.stringify({ referee_partial_sig: v.referee_partials_hex, provider_enc_partial_sig_b64: 'AA==', asp_vtxo_ref: ref });
		expect(next.parseReleaseSettle(body)).toEqual(old.parseReleaseSettle(body));
	});

	it('the op aggregates to signatures an independent BIP-340 verifier (noble) accepts under the vector Q', async () => {
		const sigs = await next.aggregateSettleSignature(tweaked, v.referee_partials_hex, v.provider_partials_hex);
		expect(sigs).toBe(v.signatures_hex.join(''));
		const q = hex(v.owner_q_xonly_hex);
		for (let i = 0; i < 2; i++) {
			expect(schnorr.verify(hex(sigs.slice(i * 128, i * 128 + 128)), hex(v.sighashes_hex.slice(i * 64, i * 64 + 64)), q)).toBe(true);
		}
		expect(toHex(await next.swapOwnerKey(tweaked))).toBe(v.owner_q_xonly_hex);
	});

	it('C1 divergence: the old TS key is the untweaked KeyAgg and rejects per-swap partials', () => {
		expect(old.ownerQXonlyHex(v.referee_pubkey_hex, v.provider_pubkey_hex)).not.toBe(v.owner_q_xonly_hex);
		const oldInputs = { ...tweaked } as old.CeremonyInputs;
		expect(() => old.verifyCeremonyPartial(oldInputs, 'referee', v.referee_partials_hex)).toThrow(/does not verify/);
	});

	it('C1 divergence: the op never accepts the old untweaked ceremony, under any swap binding', async () => {
		const legacy: next.CeremonyInputs = {
			refereePubkeyHex: untweaked.referee_pubkey_hex,
			providerPubkeyHex: untweaked.provider_pubkey_hex,
			swapId: v.swap_id,
			requestCommitment: hex(v.request_commitment_hex),
			refereeNonceHex: untweaked.referee_nonce_hex,
			providerNonceHex: untweaked.provider_nonce_hex,
			sighashHex: untweaked.sighash_hex
		};
		// The old TS accepts it (its own vector) …
		expect(old.aggregateSettleSignature(legacy as old.CeremonyInputs, untweaked.referee_partial_hex, untweaked.provider_partial_hex)).toBe(untweaked.signature_hex);
		// … the per-swap op does not.
		await expect(next.verifyCeremonyPartial(legacy, 'referee', untweaked.referee_partial_hex)).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
		await expect(next.aggregateSettleSignature(legacy, untweaked.referee_partial_hex, untweaked.provider_partial_hex)).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
	});

	it('both reject the same tampering (on each one’s own vector)', async () => {
		const legacy = {
			refereePubkeyHex: untweaked.referee_pubkey_hex,
			providerPubkeyHex: untweaked.provider_pubkey_hex,
			refereeNonceHex: untweaked.referee_nonce_hex,
			providerNonceHex: untweaked.provider_nonce_hex,
			sighashHex: untweaked.sighash_hex
		};
		expect(() => old.verifyCeremonyPartial(legacy, 'referee', flip(untweaked.referee_partial_hex))).toThrow();
		expect(() => old.verifyCeremonyPartial(legacy, 'provider', untweaked.referee_partial_hex)).toThrow();
		await expect(next.verifyCeremonyPartial(tweaked, 'referee', flip(v.referee_partials_hex))).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
		await expect(next.verifyCeremonyPartial(tweaked, 'provider', v.referee_partials_hex)).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
		await expect(next.verifyCeremonyPartial(tweaked, 'referee', v.referee_partials_hex)).resolves.toBeUndefined();
		await expect(next.verifyCeremonyPartial(tweaked, 'provider', v.provider_partials_hex)).resolves.toBeUndefined();
	});
});
