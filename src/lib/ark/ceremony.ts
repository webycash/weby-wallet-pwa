/**
 * Referee settle/refund ceremony — wallet side, as thin calls into extro-node
 * (ADR-0007, audit H2/H3). The MuSig2 protocol lives once, in extro-node's
 * `ark_protocol` (`Op::Ark`): the per-swap tweaked owner key
 * Q = KeyAgg([referee, provider]) + H(swap_id ‖ request_commitment) (audit
 * C1), BIP327 partial verification against the committed pubshares and
 * pub-nonces, and aggregation with a BIP-340 check under Q. This module only
 * shapes public wire values, routes them to the node, and maps a refusal to
 * the named gate. No key, nonce or signature arithmetic happens in JS.
 *
 * Supersedes the in-TS ceremony in `settle-ceremony.ts` (untweaked, pre-C1),
 * which is kept unused pending archive approval.
 */
import type { ArkCommand, ExtroResponse, WireArkCeremony } from '@extro/node';
import { newRequestId } from '@extro/node';
import { getExtroClient } from '$lib/extro';
import {
	GATE_REFEREE_CEREMONY_UNAVAILABLE,
	GATE_SETTLE_CEREMONY_INVALID,
	NamedArkGateError
} from './named-gates';

/** Capability the referee advertises on `GET /v1/pubkey` (referee ≥ 0e02d05). */
export const SETTLE_CEREMONY_CAPABILITY = 'settle-ceremony-v1';
/** The referee MuSig2-signs the decoded 32-byte hex sighash (not ASCII hex). */
export const HEX_SIGHASH_CAPABILITY = 'hex-sighash-v1';
/** `sighash-bundle-v1`: at most [checkpoint, ark]. */
export const MAX_SIGHASH_BUNDLE = 2;
/** Capability: hashes / nonces / partials may be N≤2 concatenated units. */
export const SIGHASH_BUNDLE_CAPABILITY = 'sighash-bundle-v1';
/** `GET /v1/swap/{id}/release` serves the signed terminal release push. */
export const RELEASE_PULL_CAPABILITY = 'release-pull-v1';
/** `GET /v1/swap/{id}/insert` serves the provider-sealed bearer secret. */
export const INSERT_PULL_CAPABILITY = 'insert-pull-v1';

const HEX33 = /^0[23][0-9a-f]{64}$/;

const invalid = (detail: string): NamedArkGateError =>
	new NamedArkGateError(`${GATE_SETTLE_CEREMONY_INVALID} (${detail})`);

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

/**
 * Number of `unit`-byte items in a bundle hex string, or 0 if malformed. A
 * wire-shape pre-check only (fail before the single-use provider nonce is
 * consumed); the node re-parses every value it is given.
 */
export function bundleCount(hex: string, unit: number): number {
	if (!/^([0-9a-f]{2})+$/i.test(hex)) return 0;
	const len = hex.length / 2;
	if (len % unit !== 0) return 0;
	const n = len / unit;
	return n >= 1 && n <= MAX_SIGHASH_BUNDLE ? n : 0;
}

/** Public inputs of one swap ceremony — lowercase hex as on the wire. */
export interface CeremonyInputs {
	/** Referee MuSig2 pubshare (33-byte compressed). */
	refereePubkeyHex: string;
	/** Provider MuSig2 pubkey (33-byte compressed). */
	providerPubkeyHex: string;
	/** The referee-verified swap id the owner key is tweaked by (C1). */
	swapId: string;
	/** The 32-byte prepare request commitment the owner key is tweaked by (C1). */
	requestCommitment: Uint8Array;
	/** Referee pub-nonces (N × 66 bytes, bundle order). */
	refereeNonceHex: string;
	/** Provider pub-nonces (N × 66 bytes, bundle order). */
	providerNonceHex: string;
	/** `sighash-bundle-v1`: N × 32-byte sighashes `[checkpoint, ark]`. */
	sighashHex: string;
}

export type CeremonySigner = 'referee' | 'provider';

/**
 * Normalise and shape-check every public input before anything is signed;
 * throws ARK_SETTLE_CEREMONY_INVALID.
 */
export function checkCeremonyInputs(inputs: CeremonyInputs): CeremonyInputs {
	const out: CeremonyInputs = {
		refereePubkeyHex: inputs.refereePubkeyHex.toLowerCase(),
		providerPubkeyHex: inputs.providerPubkeyHex.toLowerCase(),
		swapId: inputs.swapId,
		requestCommitment: inputs.requestCommitment,
		refereeNonceHex: inputs.refereeNonceHex.toLowerCase(),
		providerNonceHex: inputs.providerNonceHex.toLowerCase(),
		sighashHex: inputs.sighashHex.toLowerCase()
	};
	if (!HEX33.test(out.refereePubkeyHex)) throw invalid('referee pubshare must be 33-byte compressed hex');
	if (!HEX33.test(out.providerPubkeyHex)) throw invalid('provider pubkey must be 33-byte compressed hex');
	if (out.refereePubkeyHex === out.providerPubkeyHex) throw invalid('referee and provider keys must differ');
	if (out.swapId.length === 0) throw invalid('swap id is empty');
	if (!(out.requestCommitment instanceof Uint8Array) || out.requestCommitment.length !== 32)
		throw invalid('request commitment must be 32 bytes');
	const n = bundleCount(out.sighashHex, 32);
	if (!n) throw invalid('sighash must be 1..2 × 32-byte hex');
	if (bundleCount(out.refereeNonceHex, 66) !== n) throw invalid(`referee nonce must be ${n} × 66-byte hex`);
	if (bundleCount(out.providerNonceHex, 66) !== n) throw invalid(`provider nonce must be ${n} × 66-byte hex`);
	return out;
}

const wire = (c: CeremonyInputs): WireArkCeremony => ({
	referee_pubkey_hex: c.refereePubkeyHex,
	provider_pubkey_hex: c.providerPubkeyHex,
	swap_id: c.swapId,
	request_commitment: c.requestCommitment.slice(),
	referee_nonce_hex: c.refereeNonceHex,
	provider_nonce_hex: c.providerNonceHex,
	sighash_hex: c.sighashHex
});

type OkBody = Extract<ExtroResponse, { kind: 'Ok' }>['body'];

/** One `Op::Ark` round-trip; a node refusal becomes ARK_SETTLE_CEREMONY_INVALID. */
async function ark<K extends OkBody['kind']>(cmd: ArkCommand, want: K): Promise<Extract<OkBody, { kind: K }>> {
	const res = await getExtroClient().send({ request_id: newRequestId(), op: { kind: 'Ark', cmd } });
	if (res.kind === 'Err') throw invalid(`${cmd.op}: ${res.message}`);
	if (res.body.kind !== want) throw invalid(`${cmd.op}: unexpected ${res.body.kind}`);
	return res.body as Extract<OkBody, { kind: K }>;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((x, i) => x === b[i]);

/** The per-swap tweaked x-only owner key Q (extro-node `TwoOfTwoKey::for_swap`). */
export async function swapOwnerKey(input: {
	refereePubkeyHex: string;
	providerPubkeyHex: string;
	swapId: string;
	requestCommitment: Uint8Array;
}): Promise<Uint8Array> {
	const body = await ark(
		{
			op: 'SwapOwnerKey',
			referee_pubkey_hex: input.refereePubkeyHex.toLowerCase(),
			provider_pubkey_hex: input.providerPubkeyHex.toLowerCase(),
			swap_id: input.swapId,
			request_commitment: input.requestCommitment.slice()
		},
		'ArkOwnerKey'
	);
	return body.owner_q;
}

/**
 * Bind the ceremony keys to the referee-verified contract: the per-swap Q of
 * the pubshare/pubkey pair must equal the plan's aggregate owner key exactly,
 * so a swapped order, foreign key or other swap's binding is never co-signed.
 */
export async function assertCeremonyMatchesOwnerKey(
	inputs: Pick<CeremonyInputs, 'refereePubkeyHex' | 'providerPubkeyHex' | 'swapId' | 'requestCommitment'>,
	aggregateOwnerKey: Uint8Array
): Promise<void> {
	const q = await swapOwnerKey(inputs);
	if (aggregateOwnerKey.length !== 32 || !sameBytes(q, aggregateOwnerKey)) {
		throw invalid('per-swap KeyAgg([referee, provider]) does not equal the referee-verified contract owner key');
	}
}

/** Verify one signer's partial bundle (N × 32 bytes) against the ceremony. */
export async function verifyCeremonyPartial(
	raw: CeremonyInputs,
	signer: CeremonySigner,
	partialHex: string
): Promise<void> {
	const inputs = checkCeremonyInputs(raw);
	const n = bundleCount(inputs.sighashHex, 32);
	if (bundleCount(partialHex, 32) !== n) throw invalid(`${signer} partial must be ${n} × 32-byte hex`);
	await ark(
		{
			op: 'VerifyCeremonyPartial',
			ceremony: wire(inputs),
			signer: signer === 'referee' ? 'Referee' : 'Provider',
			partial_hex: partialHex.toLowerCase()
		},
		'Empty'
	);
}

/**
 * Verify both partial bundles, aggregate each message in key order and
 * BIP-340-verify every signature under Q (all inside the node). Returns the
 * concatenated N × 64-byte signatures hex (`[checkpoint, ark]`).
 */
export async function aggregateSettleSignature(
	raw: CeremonyInputs,
	refereePartialHex: string,
	providerPartialHex: string
): Promise<string> {
	const inputs = checkCeremonyInputs(raw);
	const n = bundleCount(inputs.sighashHex, 32);
	if (bundleCount(refereePartialHex, 32) !== n) throw invalid(`referee partial must be ${n} × 32-byte hex`);
	if (bundleCount(providerPartialHex, 32) !== n) throw invalid(`provider partial must be ${n} × 32-byte hex`);
	const body = await ark(
		{
			op: 'AggregateCeremony',
			ceremony: wire(inputs),
			referee_partial_hex: refereePartialHex.toLowerCase(),
			provider_partial_hex: providerPartialHex.toLowerCase()
		},
		'ArkSignatures'
	);
	const sigs = body.signatures_hex.toLowerCase();
	if (!/^[0-9a-f]+$/.test(sigs) || sigs.length !== 128 * n) throw invalid('node returned a malformed signature bundle');
	return sigs;
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
 * referee must advertise the ceremony capabilities and serve the same MuSig2
 * pubshare the prepared swap committed to. An older referee (no
 * `capabilities`) stops the swap at ARK_REFEREE_CEREMONY_UNAVAILABLE.
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
