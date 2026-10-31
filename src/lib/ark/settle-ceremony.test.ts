import { describe, expect, it } from 'vitest';
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
