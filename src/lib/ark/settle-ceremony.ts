/**
 * Referee settle ceremony — wallet side (blocker 3, replaces the
 * ARK_SETTLE_SIGNER_PENDING stop).
 *
 * The 2-of-2 owner key is Q = KeyAgg([referee, provider]) in that canonical
 * order (referee `settle_ceremony::key_agg`, extro-node `two_of_two_owner_q`).
 * The settle spend needs one BIP327 partial from each signer over the same
 * 32-byte sighash (`tx_settle_hash`):
 *
 *   - provider: `Scheme402 ProviderPartialSign` inside the WASM (key + secret
 *     nonce never leave extro-node), then self-verified here;
 *   - referee: produced once on `settled` and pushed as `ReleaseSettle`
 *     (`referee_partial_sig`, `provider_enc_partial_sig_b64`, `asp_vtxo_ref`).
 *
 * The bearer-seller verifies BOTH partials against the committed pubshares +
 * pub-nonces, aggregates, and BIP340-verifies the result under Q. Only PUBLIC
 * values are handled in JS (pubkeys, pub-nonces, partials) — no secret key or
 * secret nonce exists outside the WASM. Every check fails closed with a named
 * gate; nothing here broadcasts.
 */
import { Session, keyAggExport, keyAggregate, nonceAggregate } from '@scure/btc-signer/musig2.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import {
	GATE_REFEREE_CEREMONY_UNAVAILABLE,
	GATE_SETTLE_CEREMONY_INVALID,
	NamedArkGateError
} from './named-gates';

/** Capability the referee advertises on `GET /v1/pubkey` (referee ≥ 0e02d05). */
export const SETTLE_CEREMONY_CAPABILITY = 'settle-ceremony-v1';
/** The referee MuSig2-signs the decoded 32-byte hex sighash (not ASCII hex). */
export const HEX_SIGHASH_CAPABILITY = 'hex-sighash-v1';

const HEX32 = /^[0-9a-f]{64}$/i;
const HEX33 = /^0[23][0-9a-f]{64}$/i;
/** `sighash-bundle-v1`: at most [checkpoint, ark]. */
export const MAX_SIGHASH_BUNDLE = 2;
/** Capability: hashes / nonces / partials may be N≤2 concatenated units. */
export const SIGHASH_BUNDLE_CAPABILITY = 'sighash-bundle-v1';
/** `GET /v1/swap/{id}/release` serves the signed terminal release push. */
export const RELEASE_PULL_CAPABILITY = 'release-pull-v1';
/** `GET /v1/swap/{id}/insert` serves the provider-sealed bearer secret. */
export const INSERT_PULL_CAPABILITY = 'insert-pull-v1';

/**
 * Does the referee's `asp_vtxo_ref` name `lockedRef`? The referee reports
 * either the bare outpoint, `asp:{net}:{outpoint}:{tx}:{obs}:partial=…`
 * (read-only ASP observation) or `asp-unverified:{error}` when the ASP lookup
 * failed (non-blocking on the referee). The ref is informational — the real
 * binding is the partial signatures verifying over this VTXO's sighashes — but
 * a ref that names a DIFFERENT outpoint is rejected.
 */
export function releaseNamesLockedRef(aspVtxoRef: string, lockedRef: string): boolean {
	const ref = aspVtxoRef.toLowerCase();
	const want = lockedRef.toLowerCase();
	if (ref === want) return true;
	if (ref.startsWith('asp-unverified:')) return true;
	const m = /^asp:(?:[a-z0-9]+:)?([0-9a-f]{64}:\d+)(?::|$)/.exec(ref);
	return m !== null && m[1] === want;
}

const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const bytesToHex = (b: Uint8Array): string =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Number of `unit`-byte items in a bundle hex string, or 0 if malformed. */
export function bundleCount(hex: string, unit: number): number {
	if (!/^([0-9a-f]{2})+$/i.test(hex)) return 0;
	const len = hex.length / 2;
	if (len % unit !== 0) return 0;
	const n = len / unit;
	return n >= 1 && n <= MAX_SIGHASH_BUNDLE ? n : 0;
}

/** Split bundle hex into `unit`-byte lowercase hex chunks. */
export function splitBundle(hex: string, unit: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < hex.length; i += unit * 2) out.push(hex.slice(i, i + unit * 2).toLowerCase());
	return out;
}

/** Public inputs of one settle ceremony — all lowercase hex as on the wire. */
export interface CeremonyInputs {
	/** Referee MuSig2 pubshare (33-byte compressed). */
	refereePubkeyHex: string;
	/** Provider MuSig2 pubkey (33-byte compressed). */
	providerPubkeyHex: string;
	/** Referee settle pub-nonces (N × 66 bytes, bundle order). */
	refereeNonceHex: string;
	/** Provider settle pub-nonces (N × 66 bytes, bundle order). */
	providerNonceHex: string;
	/**
	 * `sighash-bundle-v1` (`tx_settle_hash` / `tx_refund_hash`): N × 32-byte
	 * sighashes `[checkpoint, ark]` (N=1 legacy single hash).
	 */
	sighashHex: string;
}

export type CeremonySigner = 'referee' | 'provider';

const invalid = (detail: string): NamedArkGateError =>
	new NamedArkGateError(`${GATE_SETTLE_CEREMONY_INVALID} (${detail})`);

/** Shape-check every public input; throws ARK_SETTLE_CEREMONY_INVALID. */
export function checkCeremonyInputs(inputs: CeremonyInputs): CeremonyInputs {
	const out: CeremonyInputs = {
		refereePubkeyHex: inputs.refereePubkeyHex.toLowerCase(),
		providerPubkeyHex: inputs.providerPubkeyHex.toLowerCase(),
		refereeNonceHex: inputs.refereeNonceHex.toLowerCase(),
		providerNonceHex: inputs.providerNonceHex.toLowerCase(),
		sighashHex: inputs.sighashHex.toLowerCase()
	};
	if (!HEX33.test(out.refereePubkeyHex))
		throw invalid('referee pubshare must be 33-byte compressed hex');
	if (!HEX33.test(out.providerPubkeyHex))
		throw invalid('provider pubkey must be 33-byte compressed hex');
	if (out.refereePubkeyHex === out.providerPubkeyHex)
		throw invalid('referee and provider keys must differ');
	const n = bundleCount(out.sighashHex, 32);
	if (!n) throw invalid('settle sighash must be 1..2 × 32-byte hex');
	if (bundleCount(out.refereeNonceHex, 66) !== n)
		throw invalid(`referee settle nonce must be ${n} × 66-byte hex`);
	if (bundleCount(out.providerNonceHex, 66) !== n)
		throw invalid(`provider settle nonce must be ${n} × 66-byte hex`);
	return out;
}

function pubkeys(inputs: CeremonyInputs): Uint8Array[] {
	// Canonical order [referee, provider] — never sorted.
	return [hexToBytes(inputs.refereePubkeyHex), hexToBytes(inputs.providerPubkeyHex)];
}

/** x-only Q = KeyAgg([referee, provider]) (BIP327 GetXonlyPubkey). */
export function ownerQXonlyHex(refereePubkeyHex: string, providerPubkeyHex: string): string {
	try {
		return bytesToHex(keyAggExport(keyAggregate([hexToBytes(refereePubkeyHex), hexToBytes(providerPubkeyHex)])));
	} catch (e) {
		throw invalid(`key aggregation failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Bind the ceremony keys to the referee-verified contract: KeyAgg of the
 * pubshare/pubkey pair must equal the plan's aggregate owner key exactly, so a
 * swapped order or foreign key can never be co-signed.
 */
export function assertCeremonyMatchesOwnerKey(inputs: CeremonyInputs, aggregateOwnerKey: Uint8Array): void {
	const q = ownerQXonlyHex(inputs.refereePubkeyHex, inputs.providerPubkeyHex);
	if (aggregateOwnerKey.length !== 32 || q !== bytesToHex(aggregateOwnerKey)) {
		throw invalid('KeyAgg([referee, provider]) does not equal the referee-verified contract owner key');
	}
}

function session(
	inputs: CeremonyInputs,
	i: number
): { s: Session; nonces: Uint8Array[]; msg: Uint8Array } {
	const nonces = [
		splitBundle(inputs.refereeNonceHex, 66)[i],
		splitBundle(inputs.providerNonceHex, 66)[i]
	].map(hexToBytes);
	const msg = hexToBytes(splitBundle(inputs.sighashHex, 32)[i]);
	try {
		const agg = nonceAggregate(nonces);
		return { s: new Session(agg, pubkeys(inputs), msg), nonces, msg };
	} catch (e) {
		throw invalid(`session ${i} setup failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Verify one signer's partial bundle (N × 32 bytes) against its committed
 * pubkey + pub-nonces for exactly this sighash bundle.
 */
export function verifyCeremonyPartial(
	raw: CeremonyInputs,
	signer: CeremonySigner,
	partialHex: string
): void {
	const inputs = checkCeremonyInputs(raw);
	const n = bundleCount(inputs.sighashHex, 32);
	if (bundleCount(partialHex, 32) !== n)
		throw invalid(`${signer} partial must be ${n} × 32-byte hex`);
	const parts = splitBundle(partialHex, 32);
	for (let i = 0; i < n; i++) {
		const { s, nonces } = session(inputs, i);
		let ok = false;
		try {
			ok = s.partialSigVerify(hexToBytes(parts[i]), nonces, signer === 'referee' ? 0 : 1);
		} catch {
			ok = false;
		}
		if (!ok) throw invalid(`${signer} partial ${i} does not verify`);
	}
}

/**
 * Bearer-seller aggregate: verify both partial bundles, aggregate each
 * message in key order, and BIP340-verify every 64-byte signature under Q.
 * Returns the concatenated N × 64-byte signatures hex (`[checkpoint, ark]`).
 */
export function aggregateSettleSignature(
	raw: CeremonyInputs,
	refereePartialHex: string,
	providerPartialHex: string
): string {
	const inputs = checkCeremonyInputs(raw);
	verifyCeremonyPartial(inputs, 'referee', refereePartialHex);
	verifyCeremonyPartial(inputs, 'provider', providerPartialHex);
	const q = hexToBytes(ownerQXonlyHex(inputs.refereePubkeyHex, inputs.providerPubkeyHex));
	const ref = splitBundle(refereePartialHex, 32);
	const prov = splitBundle(providerPartialHex, 32);
	let out = '';
	for (let i = 0; i < ref.length; i++) {
		const { s, msg } = session(inputs, i);
		let sig: Uint8Array;
		try {
			sig = s.partialSigAgg([hexToBytes(ref[i]), hexToBytes(prov[i])]);
		} catch (e) {
			throw invalid(`aggregate ${i} failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (!schnorr.verify(sig, msg, q))
			throw invalid(`aggregate signature ${i} does not verify under Q`);
		out += bytesToHex(sig);
	}
	return out;
}

/** Decoded `ReleaseSettle` push body (referee `ensure_settle_release`). */
export interface ReleaseSettle {
	refereePartialHex: string;
	providerEncPartialB64: string;
	aspVtxoRef: string;
}

/**
 * Parse a `ReleaseSettle` payload. An older referee (no ceremony) pushes no
 * `referee_partial_sig`; that and any malformed field fail closed.
 */
export function parseReleaseSettle(payload: Uint8Array | string): ReleaseSettle {
	let body: unknown;
	try {
		body = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload));
	} catch {
		throw new NamedArkGateError(`${GATE_REFEREE_CEREMONY_UNAVAILABLE} (ReleaseSettle is not JSON)`);
	}
	const b = (body ?? {}) as Record<string, unknown>;
	const partial = b.referee_partial_sig;
	if (typeof partial !== 'string') {
		throw new NamedArkGateError(`${GATE_REFEREE_CEREMONY_UNAVAILABLE} (ReleaseSettle has no referee_partial_sig)`);
	}
	if (!bundleCount(partial, 32)) throw invalid('referee_partial_sig must be 1..2 × 32-byte hex');
	const enc = b.provider_enc_partial_sig_b64;
	if (typeof enc !== 'string' || enc.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(enc)) {
		throw invalid('provider_enc_partial_sig_b64 missing or not base64');
	}
	const asp = b.asp_vtxo_ref;
	if (typeof asp !== 'string') throw invalid('asp_vtxo_ref missing');
	return { refereePartialHex: partial.toLowerCase(), providerEncPartialB64: enc, aspVtxoRef: asp };
}

/** The slice of the referee client this check needs (`GET /v1/pubkey`). */
export interface CeremonyRefereeProbe {
	pubkey(): Promise<{ musig2_pubshare_hex: string; capabilities?: unknown }>;
}

/**
 * Fail-closed capability handshake BEFORE any funding or signing: the pinned
 * referee must advertise `settle-ceremony-v1` + `hex-sighash-v1` and serve the
 * same MuSig2 pubshare the prepared swap committed to. An older referee
 * (no `capabilities`) stops the swap at ARK_REFEREE_CEREMONY_UNAVAILABLE.
 */
export async function assertRefereeCeremony(
	referee: CeremonyRefereeProbe,
	expectedPubshareHex: string
): Promise<void> {
	let pk: { musig2_pubshare_hex: string; capabilities?: unknown };
	try {
		pk = await referee.pubkey();
	} catch (e) {
		throw new NamedArkGateError(
			`${GATE_REFEREE_CEREMONY_UNAVAILABLE} (GET /v1/pubkey failed: ${e instanceof Error ? e.message : String(e)})`
		);
	}
	const caps = Array.isArray(pk.capabilities)
		? pk.capabilities.filter((c): c is string => typeof c === 'string')
		: [];
	for (const need of [
		SETTLE_CEREMONY_CAPABILITY,
		HEX_SIGHASH_CAPABILITY,
		SIGHASH_BUNDLE_CAPABILITY,
		RELEASE_PULL_CAPABILITY,
		INSERT_PULL_CAPABILITY
	]) {
		if (!caps.includes(need)) {
			throw new NamedArkGateError(`${GATE_REFEREE_CEREMONY_UNAVAILABLE} (referee does not advertise ${need})`);
		}
	}
	if (
		typeof pk.musig2_pubshare_hex !== 'string' ||
		pk.musig2_pubshare_hex.toLowerCase() !== expectedPubshareHex.toLowerCase()
	) {
		throw new NamedArkGateError(
			`${GATE_REFEREE_CEREMONY_UNAVAILABLE} (referee MuSig2 pubshare differs from the prepared swap)`
		);
	}
}
