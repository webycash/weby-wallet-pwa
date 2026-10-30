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
const HEX66 = /^[0-9a-f]{132}$/i;

const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const bytesToHex = (b: Uint8Array): string =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Public inputs of one settle ceremony — all lowercase hex as on the wire. */
export interface CeremonyInputs {
	/** Referee MuSig2 pubshare (33-byte compressed). */
	refereePubkeyHex: string;
	/** Provider MuSig2 pubkey (33-byte compressed). */
	providerPubkeyHex: string;
	/** Referee settle pub-nonce (66 bytes). */
	refereeNonceHex: string;
	/** Provider settle pub-nonce (66 bytes). */
	providerNonceHex: string;
	/** The 32-byte sighash both parties sign (`tx_settle_hash`). */
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
	if (!HEX33.test(out.refereePubkeyHex)) throw invalid('referee pubshare must be 33-byte compressed hex');
	if (!HEX33.test(out.providerPubkeyHex)) throw invalid('provider pubkey must be 33-byte compressed hex');
	if (out.refereePubkeyHex === out.providerPubkeyHex) throw invalid('referee and provider keys must differ');
	if (!HEX66.test(out.refereeNonceHex)) throw invalid('referee settle nonce must be 66-byte hex');
	if (!HEX66.test(out.providerNonceHex)) throw invalid('provider settle nonce must be 66-byte hex');
	if (!HEX32.test(out.sighashHex)) throw invalid('settle sighash must be 32-byte hex');
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

function session(inputs: CeremonyInputs): { s: Session; nonces: Uint8Array[] } {
	const nonces = [hexToBytes(inputs.refereeNonceHex), hexToBytes(inputs.providerNonceHex)];
	try {
		const agg = nonceAggregate(nonces);
		return { s: new Session(agg, pubkeys(inputs), hexToBytes(inputs.sighashHex)), nonces };
	} catch (e) {
		throw invalid(`session setup failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** Verify one partial against its committed pubkey + pub-nonce for exactly this sighash. */
export function verifyCeremonyPartial(raw: CeremonyInputs, signer: CeremonySigner, partialHex: string): void {
	const inputs = checkCeremonyInputs(raw);
	if (!HEX32.test(partialHex)) throw invalid(`${signer} partial must be 32-byte hex`);
	const { s, nonces } = session(inputs);
	let ok = false;
	try {
		ok = s.partialSigVerify(hexToBytes(partialHex), nonces, signer === 'referee' ? 0 : 1);
	} catch {
		ok = false;
	}
	if (!ok) throw invalid(`${signer} partial does not verify`);
}

/**
 * Bearer-seller aggregate: verify both partials, aggregate in key order, and
 * BIP340-verify the 64-byte signature under Q. Returns the signature hex.
 */
export function aggregateSettleSignature(
	raw: CeremonyInputs,
	refereePartialHex: string,
	providerPartialHex: string
): string {
	const inputs = checkCeremonyInputs(raw);
	verifyCeremonyPartial(inputs, 'referee', refereePartialHex);
	verifyCeremonyPartial(inputs, 'provider', providerPartialHex);
	const { s } = session(inputs);
	let sig: Uint8Array;
	try {
		sig = s.partialSigAgg([hexToBytes(refereePartialHex), hexToBytes(providerPartialHex)]);
	} catch (e) {
		throw invalid(`aggregate failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	const q = hexToBytes(ownerQXonlyHex(inputs.refereePubkeyHex, inputs.providerPubkeyHex));
	if (!schnorr.verify(sig, hexToBytes(inputs.sighashHex), q)) {
		throw invalid('aggregate signature does not verify under Q');
	}
	return bytesToHex(sig);
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
	if (!HEX32.test(partial)) throw invalid('referee_partial_sig must be 32-byte hex');
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
	const caps = Array.isArray(pk.capabilities) ? pk.capabilities.filter((c): c is string => typeof c === 'string') : [];
	for (const need of [SETTLE_CEREMONY_CAPABILITY, HEX_SIGHASH_CAPABILITY]) {
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
