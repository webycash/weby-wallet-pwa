import { describe, expect, it, vi } from 'vitest';
import vector from './settle-ceremony.vector.json';
import {
	HEX_SIGHASH_CAPABILITY,
	SETTLE_CEREMONY_CAPABILITY,
	aggregateSettleSignature,
	assertCeremonyMatchesOwnerKey,
	assertRefereeCeremony,
	ownerQXonlyHex,
	parseReleaseSettle,
	verifyCeremonyPartial,
	type CeremonyInputs
} from './settle-ceremony';
import {
	assertOwnerKeyBinding,
	providerSignSettle,
	sellerAggregateSettle,
	settleCeremonyInputs,
	type ProviderPartialSigner
} from './settle-step';

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const inputs: CeremonyInputs = {
	refereePubkeyHex: vector.referee_pubkey_hex,
	providerPubkeyHex: vector.provider_pubkey_hex,
	refereeNonceHex: vector.referee_nonce_hex,
	providerNonceHex: vector.provider_nonce_hex,
	sighashHex: vector.sighash_hex
};
const Q = hex(vector.owner_q_xonly_hex);
const flip = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);
const LOCKED = `${'ab'.repeat(32)}:0`;

describe('settle ceremony (cross-impl vector from Rust musig2 0.2.4)', () => {
	it('KeyAgg([referee, provider]) reproduces Q', () => {
		expect(ownerQXonlyHex(inputs.refereePubkeyHex, inputs.providerPubkeyHex)).toBe(vector.owner_q_xonly_hex);
		expect(() => assertCeremonyMatchesOwnerKey(inputs, Q)).not.toThrow();
	});

	it('swapped key order or a foreign key does not bind to Q', () => {
		const swapped = { ...inputs, refereePubkeyHex: inputs.providerPubkeyHex, providerPubkeyHex: inputs.refereePubkeyHex };
		expect(() => assertCeremonyMatchesOwnerKey(swapped, Q)).toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
		expect(() => assertCeremonyMatchesOwnerKey(inputs, hex('11'.repeat(32)))).toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
	});

	it('both Rust partials verify and aggregate to the exact Rust signature', () => {
		expect(() => verifyCeremonyPartial(inputs, 'referee', vector.referee_partial_hex)).not.toThrow();
		expect(() => verifyCeremonyPartial(inputs, 'provider', vector.provider_partial_hex)).not.toThrow();
		expect(aggregateSettleSignature(inputs, vector.referee_partial_hex, vector.provider_partial_hex)).toBe(
			vector.signature_hex
		);
	});

	it('rejects tampered partials, swapped roles, other sighash, other nonce', () => {
		expect(() => verifyCeremonyPartial(inputs, 'referee', flip(vector.referee_partial_hex))).toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		expect(() => verifyCeremonyPartial(inputs, 'provider', vector.referee_partial_hex)).toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		const other = { ...inputs, sighashHex: 'a5'.repeat(32) };
		expect(() => aggregateSettleSignature(other, vector.referee_partial_hex, vector.provider_partial_hex)).toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		const nonce = { ...inputs, refereeNonceHex: inputs.providerNonceHex };
		expect(() => verifyCeremonyPartial(nonce, 'referee', vector.referee_partial_hex)).toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		expect(() => verifyCeremonyPartial(inputs, 'referee', 'zz')).toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
	});

	it('rejects malformed inputs', () => {
		expect(() => verifyCeremonyPartial({ ...inputs, sighashHex: '5a' }, 'referee', vector.referee_partial_hex)).toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		expect(() =>
			verifyCeremonyPartial({ ...inputs, providerPubkeyHex: inputs.refereePubkeyHex }, 'referee', vector.referee_partial_hex)
		).toThrow(/keys must differ/);
	});
});

describe('parseReleaseSettle', () => {
	const ok = {
		referee_partial_sig: vector.referee_partial_hex,
		provider_enc_partial_sig_b64: 'AAEC',
		asp_vtxo_ref: LOCKED
	};
	it('parses the referee push body (string or bytes)', () => {
		expect(parseReleaseSettle(JSON.stringify(ok))).toEqual({
			refereePartialHex: vector.referee_partial_hex,
			providerEncPartialB64: 'AAEC',
			aspVtxoRef: LOCKED
		});
		expect(parseReleaseSettle(new TextEncoder().encode(JSON.stringify(ok))).aspVtxoRef).toBe(LOCKED);
	});
	it('fails closed on an old referee body or garbage', () => {
		expect(() => parseReleaseSettle('{"settled":true}')).toThrow(/ARK_REFEREE_CEREMONY_UNAVAILABLE/);
		expect(() => parseReleaseSettle('not json')).toThrow(/ARK_REFEREE_CEREMONY_UNAVAILABLE/);
		expect(() => parseReleaseSettle(JSON.stringify({ ...ok, referee_partial_sig: 'xx' }))).toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		expect(() => parseReleaseSettle(JSON.stringify({ ...ok, provider_enc_partial_sig_b64: '' }))).toThrow(
			/ARK_SETTLE_CEREMONY_INVALID/
		);
		expect(() => parseReleaseSettle(JSON.stringify({ ...ok, asp_vtxo_ref: 7 }))).toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
	});
});

describe('assertRefereeCeremony (fail closed against older referees)', () => {
	const caps = [
		SETTLE_CEREMONY_CAPABILITY,
		HEX_SIGHASH_CAPABILITY,
		'sighash-bundle-v1',
		'release-pull-v1',
		'insert-pull-v1',
		'ark-prepare-policies-v1'
	];
	const probe = (body: unknown) => ({ pubkey: async () => body as never });
	it('accepts a ceremony-capable referee with the prepared pubshare', async () => {
		await expect(
			assertRefereeCeremony(probe({ musig2_pubshare_hex: vector.referee_pubkey_hex, capabilities: caps }), vector.referee_pubkey_hex.toUpperCase())
		).resolves.toBeUndefined();
	});
	it('stops on the current live referee shape (no capabilities)', async () => {
		await expect(
			assertRefereeCeremony(probe({ musig2_pubshare_hex: vector.referee_pubkey_hex, referee_version: 'x' }), vector.referee_pubkey_hex)
		).rejects.toThrow(/ARK_REFEREE_CEREMONY_UNAVAILABLE.*settle-ceremony-v1/);
	});
	it('stops when hex-sighash is missing, pubshare differs, or the probe fails', async () => {
		await expect(
			assertRefereeCeremony(probe({ musig2_pubshare_hex: vector.referee_pubkey_hex, capabilities: [SETTLE_CEREMONY_CAPABILITY] }), vector.referee_pubkey_hex)
		).rejects.toThrow(/hex-sighash-v1/);
		await expect(
			assertRefereeCeremony(probe({ musig2_pubshare_hex: vector.provider_pubkey_hex, capabilities: caps }), vector.referee_pubkey_hex)
		).rejects.toThrow(/pubshare differs/);
		await expect(
			assertRefereeCeremony({ pubkey: () => Promise.reject(new Error('503')) }, vector.referee_pubkey_hex)
		).rejects.toThrow(/ARK_REFEREE_CEREMONY_UNAVAILABLE.*503/);
	});
});

describe('settle step wiring', () => {
	const prepared = { refereeMusig2Pubshare: vector.referee_pubkey_hex, refereeSettleNoncePub: vector.referee_nonce_hex };
	const material = {
		provider_musig2_pubkey: vector.provider_pubkey_hex,
		settle_nonce_pub: vector.provider_nonce_hex,
		locked_ref: LOCKED,
		tx_settle_hash_hex: vector.sighash_hex
	};
	const build = () =>
		settleCeremonyInputs({ prepared, material, lockedRef: LOCKED, settleHashHex: vector.sighash_hex, aggregateOwnerKey: Q });

	it('binds prepared + material to Q', () => {
		expect(build()).toEqual(inputs);
		expect(() =>
			assertOwnerKeyBinding({ refereePubkeyHex: prepared.refereeMusig2Pubshare, providerPubkeyHex: material.provider_musig2_pubkey, aggregateOwnerKey: Q })
		).not.toThrow();
	});

	it('refuses material for another outpoint / sighash, or a wrong Q', () => {
		expect(() =>
			settleCeremonyInputs({ prepared, material, lockedRef: `${'cd'.repeat(32)}:0`, settleHashHex: vector.sighash_hex, aggregateOwnerKey: Q })
		).toThrow(/ARK_SETTLE_CEREMONY_INVALID.*locked_ref/);
		expect(() =>
			settleCeremonyInputs({ prepared, material, lockedRef: LOCKED, settleHashHex: 'a5'.repeat(32), aggregateOwnerKey: Q })
		).toThrow(/ARK_SETTLE_CEREMONY_INVALID.*settle hash/);
		expect(() =>
			settleCeremonyInputs({ prepared, material, lockedRef: LOCKED, settleHashHex: vector.sighash_hex, aggregateOwnerKey: hex('22'.repeat(32)) })
		).toThrow(/ARK_SETTLE_CEREMONY_INVALID/);
	});

	it('provider signs via the WASM op with the extro-node fill id and self-verifies', async () => {
		const sign = vi.fn(async (_input: Parameters<ProviderPartialSigner>[0]) => vector.provider_partial_hex);
		const orderIdHex = '0f'.repeat(16);
		const fp = 'AB'.repeat(20);
		await expect(providerSignSettle({ slot: 3, orderIdHex, counterpartyFpHex: fp, inputs: build(), sign })).resolves.toBe(
			vector.provider_partial_hex
		);
		const arg = sign.mock.calls[0][0];
		expect(arg).toMatchObject({
			slot: 3,
			fillId: `${orderIdHex}:${'ab'.repeat(20)}`,
			session: 'settle',
			refereePkHex: vector.referee_pubkey_hex,
			refereeNonceHex: vector.referee_nonce_hex
		});
		expect(Array.from(arg.msg)).toEqual(Array.from(hex(vector.sighash_hex)));
	});

	it('provider refuses a WASM partial that does not verify', async () => {
		const sign = async () => flip(vector.provider_partial_hex);
		await expect(
			providerSignSettle({ slot: 0, orderIdHex: '0f'.repeat(16), counterpartyFpHex: 'ab'.repeat(20), inputs: build(), sign })
		).rejects.toThrow(/ARK_SETTLE_CEREMONY_INVALID.*provider partial/);
	});

	it('seller aggregates a ReleaseSettle for its own VTXO and refuses a foreign one', () => {
		const release = { refereePartialHex: vector.referee_partial_hex, providerEncPartialB64: 'AAEC', aspVtxoRef: LOCKED };
		expect(
			sellerAggregateSettle({ inputs: build(), release, providerPartialHex: vector.provider_partial_hex, lockedRef: LOCKED })
		).toBe(vector.signature_hex);
		expect(() =>
			sellerAggregateSettle({
				inputs: build(),
				release: { ...release, aspVtxoRef: `${'cd'.repeat(32)}:1` },
				providerPartialHex: vector.provider_partial_hex,
				lockedRef: LOCKED
			})
		).toThrow(/different VTXO/);
	});
});

describe('pull capabilities + release outpoint naming', () => {
	it('requires release-pull-v1 and insert-pull-v1', async () => {
		const probe = (caps: string[]) => ({
			pubkey: async () =>
				({ musig2_pubshare_hex: vector.referee_pubkey_hex, capabilities: caps }) as never
		});
		const base = [SETTLE_CEREMONY_CAPABILITY, HEX_SIGHASH_CAPABILITY, 'sighash-bundle-v1'];
		await expect(
			assertRefereeCeremony(probe([...base, 'insert-pull-v1']), vector.referee_pubkey_hex)
		).rejects.toThrow(/release-pull-v1/);
		await expect(
			assertRefereeCeremony(probe([...base, 'release-pull-v1']), vector.referee_pubkey_hex)
		).rejects.toThrow(/insert-pull-v1/);
	});
	it('accepts the live asp_vtxo_ref shapes for the same outpoint only', async () => {
		const { releaseNamesLockedRef } = await import('./settle-ceremony');
		const out = `${'5a'.repeat(32)}:1`;
		expect(releaseNamesLockedRef(out, out)).toBe(true);
		expect(releaseNamesLockedRef(`asp:signet:${out}:Settle:Spent:partial=ab`, out)).toBe(true);
		expect(releaseNamesLockedRef(`asp:${out}`, out)).toBe(true);
		expect(releaseNamesLockedRef('asp-unverified:timeout', out)).toBe(true);
		expect(releaseNamesLockedRef(`asp:signet:${'5b'.repeat(32)}:1:Settle`, out)).toBe(false);
		expect(releaseNamesLockedRef(`asp:signet:${'5a'.repeat(32)}:10:Settle`, out)).toBe(false);
	});
});
