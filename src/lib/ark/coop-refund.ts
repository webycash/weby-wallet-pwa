/**
 * Provider cooperative refund (referee `coop-refund-v1`) — the abort path that
 * survives a referee container eviction and a wallet reload.
 *
 * The prepare-time WASM refund nonce may be gone (page reload / abort), so the
 * provider:
 *   1. asks the referee for the durable prepare terms (`action: terms`), signed
 *      by the per-order swap-cancel key (`provider_cancel_pubkey_hex`), and
 *      binds them to its own contract (commitment, amount, destination, Q);
 *   2. draws a FRESH single-use refund nonce in the WASM under a `coop:` fill;
 *   3. sends the cancel-key-signed refund request (own refund sighash bundle +
 *      fresh nonce bundle) — the referee consumes its single prepared Refund
 *      session once and returns its partial;
 *   4. verifies the referee partial, signs its own partial in the WASM,
 *      self-verifies, and aggregates under Q.
 * JS handles public data only. Every mismatch fails closed; nothing broadcasts.
 */
import { getExtroClient } from '$lib/extro';
import { newRequestId } from '@extro/node';
import { GATE_COOP_REFUND_FAILED, NamedArkGateError } from './named-gates';
import {
	aggregateSettleSignature,
	assertCeremonyMatchesOwnerKey,
	checkCeremonyInputs,
	verifyCeremonyPartial,
	type CeremonyInputs
} from './ceremony';
import type { ProviderPartialSigner } from './settle-step';
import { wasmProviderPartialSign } from './wasm-cosign';

export const COOP_REFUND_CAPABILITY = 'coop-refund-v1';
/** Referee `MAX_REQUEST_TTL_SECS` is 600; stay well inside it. */
export const COOP_REFUND_TTL_SECS = 300;

export interface CoopRefundTerms {
	swap_id: string;
	action: 'terms' | 'refund';
	phase: string;
	request_commitment_hex: string;
	prepare_terms_b64: string;
	ark_network: string;
	ark_amount_sats: number;
	provider_ark_destination: string;
	referee_musig2_pubshare_hex: string;
	referee_refund_nonce_bundle_hex: string;
	referee_refund_partial_hex?: string | null;
}

export interface CoopSignInput {
	slot: number;
	orderIdHex: string;
	swapId: string;
	requestCommitmentHex: string;
	action: 'terms' | 'refund';
	sighashBundleHex: string;
	nonceBundleHex: string;
	expiresAtUnix: number;
}
export type CoopRequestSigner = (i: CoopSignInput) => Promise<{ signatureHex: string; cancelPubkeyHex: string }>;
export type FreshRefundNonce = (i: { slot: number; fillId: string }) => Promise<{ pubkeyHex: string; refundNonceHex: string }>;

const fail = (m: string) => new NamedArkGateError(`${GATE_COOP_REFUND_FAILED} (${m})`);
const HEX = /^[0-9a-f]*$/;
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

/** WASM: sign the canonical referee message with the per-order swap-cancel key. */
export const wasmSignCoopRefund: CoopRequestSigner = async (i) => {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Scheme402',
			cmd: {
				op: 'SignCoopRefund',
				slot: i.slot,
				order_id: unhex(i.orderIdHex),
				swap_id: i.swapId,
				request_commitment_hex: i.requestCommitmentHex,
				action: i.action,
				sighash_bundle_hex: i.sighashBundleHex,
				nonce_bundle_hex: i.nonceBundleHex,
				expires_at_unix: i.expiresAtUnix
			}
		}
	});
	if (res.kind === 'Err') throw new Error(`SignCoopRefund: ${res.message}`);
	if (res.body.kind !== 'CoopRefundSignature') throw new Error(`SignCoopRefund: unexpected ${res.body.kind}`);
	return { signatureHex: res.body.signature_hex, cancelPubkeyHex: res.body.cancel_pubkey_hex };
};

/** WASM: draw a fresh single-use refund nonce bundle for a `coop:` fill. */
export const wasmFreshRefundNonce: FreshRefundNonce = async (i) => {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Scheme402', cmd: { op: 'FreshRefundNonce', slot: i.slot, fill_id: i.fillId } }
	});
	if (res.kind === 'Err') throw new Error(`FreshRefundNonce: ${res.message}`);
	if (res.body.kind !== 'ProviderMaterial') throw new Error(`FreshRefundNonce: unexpected ${res.body.kind}`);
	return { pubkeyHex: res.body.musig2_pubkey, refundNonceHex: res.body.refund_nonce };
};

export interface CoopRefundInput {
	refereeUrl: string;
	swapId: string;
	slot: number;
	/** Order id (16-byte hex): selects the per-order swap-cancel key. */
	orderIdHex: string;
	/** The countersigned prepare request commitment (32-byte hex). */
	requestCommitmentHex: string;
	/** Own refund spend sighash bundle `[checkpoint, ark]` (refs.txRefundHashHex). */
	refundHashHex: string;
	/** Contract 2-of-2 owner key Q (x-only). */
	aggregateOwnerKey: Uint8Array;
	expectAmountSats: bigint | number;
	expectDestination: string;
	/** If known (from the own offer), the referee-committed cancel key must equal it. */
	expectCancelPubkeyHex?: string;
}

export interface CoopRefundDeps {
	fetch?: typeof fetch;
	now?: () => number;
	signRequest?: CoopRequestSigner;
	freshNonce?: FreshRefundNonce;
	sign?: ProviderPartialSigner;
	randomHex?: () => string;
}

export interface CoopRefundResult {
	signaturesHex: string;
	phase: string;
	fillId: string;
	inputs: CeremonyInputs;
}

function randomHex16(): string {
	const b = new Uint8Array(16);
	crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function post(
	f: typeof fetch,
	input: CoopRefundInput,
	deps: Required<Pick<CoopRefundDeps, 'now' | 'signRequest'>>,
	action: 'terms' | 'refund',
	sighashBundleHex: string,
	nonceBundleHex: string
): Promise<CoopRefundTerms> {
	const expiresAtUnix = Math.floor(deps.now()) + COOP_REFUND_TTL_SECS;
	const { signatureHex, cancelPubkeyHex } = await deps.signRequest({
		slot: input.slot,
		orderIdHex: input.orderIdHex,
		swapId: input.swapId,
		requestCommitmentHex: input.requestCommitmentHex.toLowerCase(),
		action,
		sighashBundleHex,
		nonceBundleHex,
		expiresAtUnix
	});
	if (input.expectCancelPubkeyHex && cancelPubkeyHex.toLowerCase() !== input.expectCancelPubkeyHex.toLowerCase()) {
		throw fail('WASM cancel key differs from the offer-committed provider_cancel_pubkey_hex');
	}
	const url = `${input.refereeUrl.replace(/\/+$/, '')}/v1/swap/${encodeURIComponent(input.swapId)}/coop-refund`;
	let res: Response;
	try {
		res = await f(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				action,
				tx_refund_sighash_bundle_hex: sighashBundleHex,
				provider_refund_nonce_bundle_hex: nonceBundleHex,
				expires_at_unix: expiresAtUnix,
				signature_hex: signatureHex
			})
		});
	} catch (e) {
		throw fail(`referee unreachable: ${e instanceof Error ? e.message : String(e)}`);
	}
	const text = await res.text();
	if (!res.ok) throw fail(`referee ${action} HTTP ${res.status}: ${text.slice(0, 200)}`);
	let body: CoopRefundTerms;
	try {
		body = JSON.parse(text) as CoopRefundTerms;
	} catch {
		throw fail(`referee ${action} returned non-JSON`);
	}
	if (body.swap_id !== input.swapId || body.action !== action) throw fail('referee answered for another swap/action');
	return body;
}

/** Run coop-refund-v1 end to end; returns the aggregated refund signature bundle under Q. */
export async function coopRefundAggregate(input: CoopRefundInput, deps: CoopRefundDeps = {}): Promise<CoopRefundResult> {
	const f = deps.fetch ?? fetch;
	const d = {
		now: deps.now ?? (() => Date.now() / 1000),
		signRequest: deps.signRequest ?? wasmSignCoopRefund
	};
	const refundHash = input.refundHashHex.toLowerCase();
	if (!HEX.test(refundHash) || refundHash.length === 0 || refundHash.length % 64 !== 0 || refundHash.length > 128) {
		throw fail('refund sighash bundle must be 1..2 × 32 bytes hex');
	}
	if (!/^[0-9a-f]{32}$/i.test(input.orderIdHex)) throw fail('order id must be 16 bytes hex');
	if (!/^[0-9a-f]{64}$/i.test(input.requestCommitmentHex)) throw fail('request commitment must be 32 bytes hex');

	// 1) Durable terms → bind to the own contract.
	const terms = await post(f, input, d, 'terms', '', '');
	if (terms.request_commitment_hex.toLowerCase() !== input.requestCommitmentHex.toLowerCase())
		throw fail('referee request commitment differs from the own prepare');
	if (BigInt(terms.ark_amount_sats) !== BigInt(input.expectAmountSats)) throw fail('referee amount differs from the contract');
	if (terms.provider_ark_destination !== input.expectDestination) throw fail('referee refund destination is not ours');
	if (!['init', 'zkps-verified', 'pre-checked', 'never-initiated', 'canceled'].includes(terms.phase))
		throw fail(`swap is past the coop-refund window (phase ${terms.phase})`);

	// 2) Fresh single-use refund nonce under a coop fill.
	const fillId = `coop:${input.swapId}:${(deps.randomHex ?? randomHex16)()}`;
	const fresh = await (deps.freshNonce ?? wasmFreshRefundNonce)({ slot: input.slot, fillId });
	let inputs: CeremonyInputs;
	try {
		inputs = checkCeremonyInputs({
			refereePubkeyHex: terms.referee_musig2_pubshare_hex,
			providerPubkeyHex: fresh.pubkeyHex,
			swapId: input.swapId,
			requestCommitment: unhex(input.requestCommitmentHex),
			refereeNonceHex: terms.referee_refund_nonce_bundle_hex,
			providerNonceHex: fresh.refundNonceHex,
			sighashHex: refundHash
		});
		await assertCeremonyMatchesOwnerKey(inputs, input.aggregateOwnerKey);
	} catch (e) {
		throw fail(`ceremony inputs do not bind to Q: ${e instanceof Error ? e.message : String(e)}`);
	}

	// 3) Referee consumes its prepared Refund session once.
	const refund = await post(f, input, d, 'refund', refundHash, inputs.providerNonceHex);
	const refereePartial = refund.referee_refund_partial_hex;
	if (!refereePartial) throw fail('referee returned no refund partial');
	if (refund.referee_refund_nonce_bundle_hex !== terms.referee_refund_nonce_bundle_hex)
		throw fail('referee refund nonce changed between terms and refund');

	// 4) Verify referee, sign own (WASM), self-verify, aggregate under Q.
	try {
		await verifyCeremonyPartial(inputs, 'referee', refereePartial);
		const own = await (deps.sign ?? wasmProviderPartialSign)({
			slot: input.slot,
			fillId,
			session: 'refund',
			refereePkHex: inputs.refereePubkeyHex,
			swapId: inputs.swapId,
			requestCommitment: inputs.requestCommitment,
			refereeNonceHex: inputs.refereeNonceHex,
			msg: unhex(inputs.sighashHex)
		});
		await verifyCeremonyPartial(inputs, 'provider', own);
		const signaturesHex = await aggregateSettleSignature(inputs, refereePartial, own);
		return { signaturesHex, phase: refund.phase, fillId, inputs };
	} catch (e) {
		if (e instanceof NamedArkGateError && e.gate.startsWith('ARK_COOP_REFUND_FAILED')) throw e;
		throw fail(e instanceof Error ? e.message : String(e));
	}
}
