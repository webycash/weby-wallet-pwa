/**
 * Settle-material transport for the Ark ⇄ Webcash swap (sighash-bundle-v1).
 *
 * Protocol (docs: referee `settle-ceremony-v1` + `release-pull-v1` +
 * `insert-pull-v1`; extro-node `seal-x25519/v1`):
 *
 *   provider → seller   DHTX `SendProviderPartial`: the provider's 64-byte
 *                       settle partial bundle sealed to the seller's identity
 *                       key, AAD `webycash/provider-partial/v1|{swap}|{locked}`.
 *   seller → referee    two-proof `initiate`: the sealed bytes framed into the
 *                       128-byte `conditional_payload` (so the conditional ZKP
 *                       commits to them) + the webcash secret sealed to the
 *                       provider (`SealBearerSecret`, AAD `bearer-secret/v1|{swap}`).
 *   referee → seller    `ReleaseSettle` (`GET /v1/swap/{id}/release`): the
 *                       referee partial bundle + `provider_enc_partial_sig_b64`
 *                       = base64(conditional_payload). The seller unframes,
 *                       `OpenSealed`s, verifies and aggregates.
 *   referee → provider  `GET /v1/swap/{id}/insert`: the sealed bearer secret;
 *                       `ReleaseRefund` on the abort path.
 *
 * Every referee push is checked against the runtime-pinned referee Ed25519 key
 * (`referee:v1:audit-tip:{sha256(push-v1 body)}`), its kind, recipient and
 * payload hash before use. All decryption happens inside extro-node.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { getExtroClient } from '$lib/extro';
import { newRequestId } from '@extro/node';
import { getRuntimeConfig } from '$lib/extro/release-config';
import { ExtroWebcashRailClient, type WebcashTokenStatusOp } from '$lib/core/webcash-rail-client';
import { parseReleaseSettle, type ReleaseSettle } from '$lib/ark/ceremony';
import type { ArkSpend } from '$lib/ark/settle-tx';
import type { TwoProofFacts } from './swap-facts';

const enc = new TextEncoder();
const sha256 = async (b: Uint8Array): Promise<Uint8Array> => {
	const buf = new ArrayBuffer(b.length);
	new Uint8Array(buf).set(b);
	return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
};
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

/** Fixed conditional-circuit witness size (`extro_circuits::CONDITIONAL_WITNESS_LEN`). */
export const CONDITIONAL_PAYLOAD_LEN = 128;

export const providerPartialAad = (swapId: string, lockedRef: string): Uint8Array =>
	enc.encode(`webycash/provider-partial/v1|${swapId}|${lockedRef}`);
export const bearerSecretAad = (swapId: string): Uint8Array => enc.encode(`webycash/bearer-secret/v1|${swapId}`);

/** extro-node `frame_conditional_payload`: `u32be(len) ‖ raw ‖ 0…` (128 bytes). */
export function frameConditionalPayload(raw: Uint8Array): Uint8Array {
	if (raw.length === 0 || raw.length > CONDITIONAL_PAYLOAD_LEN - 4) {
		throw new Error(`conditional payload must be 1..${CONDITIONAL_PAYLOAD_LEN - 4} bytes`);
	}
	const out = new Uint8Array(CONDITIONAL_PAYLOAD_LEN);
	new DataView(out.buffer).setUint32(0, raw.length, false);
	out.set(raw, 4);
	return out;
}

/** Inverse of {@link frameConditionalPayload}; rejects malformed framing. */
export function unframeConditionalPayload(framed: Uint8Array): Uint8Array {
	if (framed.length !== CONDITIONAL_PAYLOAD_LEN) throw new Error('conditional payload must be 128 bytes');
	const len = new DataView(framed.buffer, framed.byteOffset, 4).getUint32(0, false);
	if (len === 0 || len > CONDITIONAL_PAYLOAD_LEN - 4) throw new Error('conditional payload length prefix is invalid');
	if (!framed.subarray(4 + len).every((b) => b === 0)) throw new Error('conditional payload has trailing bytes');
	return framed.slice(4, 4 + len);
}

export function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ── extro-node (WASM) wrappers ───────────────────────────────────────────────

async function scheme402(cmd: Record<string, unknown>, want: 'Sealed' | 'Opened'): Promise<Uint8Array> {
	const res = await getExtroClient().send({ request_id: newRequestId(), op: { kind: 'Scheme402', cmd } as never });
	if (res.kind === 'Err') throw new Error(`${String(cmd.op)}: ${res.message}`);
	if (res.body.kind !== want) throw new Error(`${String(cmd.op)}: unexpected ${res.body.kind}`);
	return (res.body as { bytes: Uint8Array }).bytes;
}

export const sealToIdentity = (recipientVk: Uint8Array, aad: Uint8Array, plaintext: Uint8Array) =>
	scheme402({ op: 'SealToIdentity', recipient_vk: recipientVk.slice(), aad, plaintext }, 'Sealed');

export const openSealed = (slot: number, aad: Uint8Array, sealed: Uint8Array) =>
	scheme402({ op: 'OpenSealed', slot, aad, sealed }, 'Opened');

export const sealBearerSecret = (input: {
	slot: number;
	publicTokenHash: Uint8Array;
	amount: string;
	providerVk: Uint8Array;
	swapId: string;
}) =>
	scheme402(
		{
			op: 'SealBearerSecret',
			slot: input.slot,
			public_token_hash: input.publicTokenHash.slice(),
			amount: input.amount,
			recipient_vk: input.providerVk.slice(),
			swap_id: input.swapId
		},
		'Sealed'
	);

export async function sendProviderPartial(input: {
	slot: number;
	orderIdHex: string;
	takerFpHex: string;
	lockedRef: string;
	sealed: Uint8Array;
}): Promise<boolean> {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: {
				op: 'SendProviderPartial',
				slot: input.slot,
				order_id: hexToBytes(input.orderIdHex),
				taker_fp: hexToBytes(input.takerFpHex),
				locked_ref: input.lockedRef,
				sealed: input.sealed.slice()
			}
		}
	});
	if (res.kind === 'Err') throw new Error(`SendProviderPartial: ${res.message}`);
	if (res.body.kind !== 'SwapMsgSent') throw new Error(`SendProviderPartial: unexpected ${res.body.kind}`);
	return res.body.delivered;
}

/** The sealed provider partial received for an order (pull-on-drain), or null. */
export async function fetchSealedProviderPartial(
	orderIdHex: string
): Promise<{ lockedRef: string; sealed: Uint8Array } | null> {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Dhtx', cmd: { op: 'FetchSwapMsgs', order_id: hexToBytes(orderIdHex) } }
	});
	if (res.kind === 'Err') throw new Error(`FetchSwapMsgs: ${res.message}`);
	if (res.body.kind !== 'SwapMsgs') throw new Error(`FetchSwapMsgs: unexpected ${res.body.kind}`);
	const p = res.body.provider_partial;
	return p ? { lockedRef: p.locked_ref, sealed: p.sealed } : null;
}

// ── Referee pulls (release-pull-v1 / insert-pull-v1) ─────────────────────────

export type PushKind = 'insert' | 'invalidate' | 'release-settle' | 'release-refund';

export interface RefereePush {
	swap_id: string;
	recipient_fp: string;
	kind: PushKind;
	payload_b64: string;
	payload_hash_hex: string;
	callback_url: string;
	signature_hex: string;
}

/** Referee push signature: Ed25519 over `referee:v1:audit-tip:{sha256(body)}`. */
export async function verifyRefereePush(
	push: RefereePush,
	expect: { refereeVkHex: string; swapId: string; kind: PushKind; recipientFpHex: string }
): Promise<Uint8Array> {
	if (push.swap_id !== expect.swapId) throw new Error('release push is for a different swap');
	if (push.kind !== expect.kind) throw new Error(`release push kind ${push.kind}, expected ${expect.kind}`);
	if (push.recipient_fp.toLowerCase() !== expect.recipientFpHex.toLowerCase()) {
		throw new Error('release push is addressed to a different party');
	}
	const payload = base64ToBytes(push.payload_b64);
	if (bytesToHex(await sha256(payload)) !== push.payload_hash_hex.toLowerCase()) {
		throw new Error('release push payload hash mismatch');
	}
	const body = enc.encode(
		`webycash-referee/push-v1:${push.swap_id}:${push.recipient_fp}:${push.kind}:${push.payload_hash_hex}:${push.callback_url}`
	);
	const canonical = enc.encode(`referee:v1:audit-tip:${bytesToHex(await sha256(body))}`);
	let ok = false;
	try {
		ok = ed25519.verify(hexToBytes(push.signature_hex), canonical, hexToBytes(expect.refereeVkHex));
	} catch {
		ok = false;
	}
	if (!ok) throw new Error('release push signature does not verify under the pinned referee key');
	return payload;
}

export interface RefereePullClient {
	release(swapId: string): Promise<{ phase: string; release: RefereePush | null }>;
	insert(
		swapId: string
	): Promise<{
		phase: string;
		insert: { recipient_fp: string; public_hash: string; amount: string; enc_secret_for_provider_b64: string } | null;
	}>;
}

export function httpRefereePullClient(baseUrl: string, fetchFn: typeof fetch = fetch): RefereePullClient {
	const url = (p: string) => `${baseUrl.replace(/\/+$/, '')}${p}`;
	const get = async <T>(p: string): Promise<T> => {
		const r = await fetchFn(url(p));
		if (!r.ok) throw new Error(`GET ${p}: ${r.status}`);
		return (await r.json()) as T;
	};
	return {
		release: (id) => get(`/v1/swap/${encodeURIComponent(id)}/release`),
		insert: (id) => get(`/v1/swap/${encodeURIComponent(id)}/insert`)
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `probe` yields a value or the deadline passes (null). */
export async function pollUntil<T>(
	probe: () => Promise<T | null>,
	timeoutMs: number,
	intervalMs: number
): Promise<T | null> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const v = await probe();
		if (v !== null) return v;
		if (Date.now() >= deadline) return null;
		await sleep(intervalMs);
	}
}

/** Webcash public hash: SHA256 of the ASCII secret hex (`e{amt}:secret:{hex}`). */
export async function webcashPublicHashHex(webcash: string): Promise<string> {
	const m = /^e(\d+(?:\.\d+)?):secret:([0-9a-f]{64})$/i.exec(webcash.trim());
	if (!m) throw new Error('opened bearer secret is not an `e{amount}:secret:{hex}` webcash');
	return bytesToHex(await sha256(enc.encode(m[2].toLowerCase())));
}

// ── Transport contract used by ark-swap-protocol ─────────────────────────────

/** Outcome the provider waits for after delivering its settle partial. */
export type ProviderOutcome = { kind: 'insert'; webcash: string } | { kind: 'refund'; refereePartialHex: string };

/**
 * Delivery of the settle ceremony messages. Every hook is optional so tests and
 * older callers can stop at a named gate; {@link defaultSettleTransport} wires
 * all of them to DHTX + the pinned referee + the in-WASM sealer.
 */
export type SettleTransport = {
	// ── provider ──
	/** Seal the self-verified settle partial to the seller and deliver it. */
	deliverProviderPartial?: (ctx: {
		slot: number;
		orderIdHex: string;
		sellerFpHex: string;
		sellerVkHex: string;
		swapId: string;
		lockedRef: string;
		partialHex: string;
	}) => Promise<void>;
	/** Next provider outcome: the sealed bearer secret (opened) or a ReleaseRefund partial. */
	awaitProviderOutcome?: (ctx: {
		slot: number;
		swapId: string;
		selfFpHex: string;
		publicHashHex?: string;
	}) => Promise<ProviderOutcome | null>;
	/** Insert (claim) the opened webcash secret into the local wallet (flips H to Spent). */
	insertBearer?: (webcash: string) => Promise<void>;
	// ── seller ──
	/** The provider's sealed settle partial for `lockedRef`, opened in-WASM. */
	awaitProviderPartial?: (ctx: {
		slot: number;
		orderIdHex: string;
		swapId: string;
		lockedRef: string;
	}) => Promise<{ sealed: Uint8Array; partialHex: string } | null>;
	/** Seal the bearer secret (by H) to the provider identity key. */
	sealBearerSecret?: (ctx: {
		slot: number;
		publicTokenHash: Uint8Array;
		amount: string;
		providerVk: Uint8Array;
		swapId: string;
	}) => Promise<Uint8Array>;
	/** Two-proof prove + `POST /v1/swap/initiate`. */
	initiate?: (ctx: { slot: number; facts: TwoProofFacts }) => Promise<{ swapId: string; phase: string }>;
	/** `POST /v1/swap/{id}/advance` (one post-check). */
	advance?: (swapId: string) => Promise<{ phase: string; terminal: boolean }>;
	/** Is the bearer public token `e{amount}:public:{H}` spent on the webcash server? */
	bearerSpent?: (publicWebcash: string) => Promise<boolean>;
	/** Referee ReleaseSettle (verified push) + the provider partial decrypted from it. */
	awaitReleaseSettle?: (ctx: {
		slot: number;
		swapId: string;
		lockedRef: string;
		selfFpHex: string;
	}) => Promise<{ release: ReleaseSettle; providerPartialHex: string } | null>;
	// ── both ──
	/** Broadcast the aggregated `[checkpoint, ark]` spend through the ASP. */
	submitSpend?: (ctx: { spend: ArkSpend; qXonly: Uint8Array; aggregateSigsHex: string }) => Promise<string>;
};

const hex64n = /^(?:[0-9a-f]{64}){1,2}$/;

/**
 * Open a sealed provider partial and check it is a 32·N-byte bundle. Returns
 * lowercase hex. The AAD binds the swap id and funded outpoint.
 */
export async function openProviderPartial(
	slot: number,
	swapId: string,
	lockedRef: string,
	sealed: Uint8Array
): Promise<string> {
	const raw = await openSealed(slot, providerPartialAad(swapId, lockedRef), sealed);
	const hex = bytesToHex(raw);
	if (!hex64n.test(hex)) throw new Error('opened provider partial must be 1..2 × 32 bytes');
	return hex;
}

/** Default transport: DHTX provider-partial + pinned referee pulls + in-WASM seal/open. */
export function defaultSettleTransport(
	deps: { fetchFn?: typeof fetch; tokenStatus?: WebcashTokenStatusOp } = {}
): SettleTransport {
	const fetchFn = deps.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
	const cfg = () => getRuntimeConfig();
	const pull = () => httpRefereePullClient(cfg().referee_url, fetchFn);
	return {
		async deliverProviderPartial(ctx) {
			const sealed = await sealToIdentity(
				hexToBytes(ctx.sellerVkHex),
				providerPartialAad(ctx.swapId, ctx.lockedRef),
				hexToBytes(ctx.partialHex)
			);
			await sendProviderPartial({
				slot: ctx.slot,
				orderIdHex: ctx.orderIdHex,
				takerFpHex: ctx.sellerFpHex,
				lockedRef: ctx.lockedRef,
				sealed
			});
		},
		async awaitProviderOutcome(ctx) {
			const p = pull();
			const ins = await p.insert(ctx.swapId);
			if (ins.insert) {
				if (ins.insert.recipient_fp.toLowerCase() !== ctx.selfFpHex.toLowerCase()) {
					throw new Error('referee insert is addressed to a different provider');
				}
				const opened = await openSealed(
					ctx.slot,
					bearerSecretAad(ctx.swapId),
					base64ToBytes(ins.insert.enc_secret_for_provider_b64)
				);
				const webcash = new TextDecoder().decode(opened);
				const h = await webcashPublicHashHex(webcash);
				if (
					h !== ins.insert.public_hash.toLowerCase() ||
					(ctx.publicHashHex && h !== ctx.publicHashHex.toLowerCase())
				) {
					throw new Error('opened bearer secret does not hash to the committed public hash');
				}
				return { kind: 'insert', webcash };
			}
			const rel = await p.release(ctx.swapId);
			if (rel.release && rel.release.kind === 'release-refund') {
				const payload = await verifyRefereePush(rel.release, {
					refereeVkHex: cfg().referee_vk_hex,
					swapId: ctx.swapId,
					kind: 'release-refund',
					recipientFpHex: ctx.selfFpHex
				});
				const partial = new TextDecoder().decode(payload).trim().toLowerCase();
				if (!hex64n.test(partial)) throw new Error('ReleaseRefund partial must be 1..2 × 32-byte hex');
				return { kind: 'refund', refereePartialHex: partial };
			}
			return null;
		},
		async insertBearer(webcash) {
			// Pinned to the webcash family (the active UI family may be bitcoin).
			const { insertWebcashIntoWebcashWallet } = await import('$lib/stores/wallet.svelte');
			const r = await insertWebcashIntoWebcashWallet(webcash);
			if (!r.ok) throw new Error(r.error);
		},
		async awaitProviderPartial(ctx) {
			const got = await fetchSealedProviderPartial(ctx.orderIdHex);
			if (!got || got.lockedRef !== ctx.lockedRef) return null;
			const partialHex = await openProviderPartial(ctx.slot, ctx.swapId, ctx.lockedRef, got.sealed);
			return { sealed: got.sealed, partialHex };
		},
		sealBearerSecret: (ctx) => sealBearerSecret(ctx),
		async initiate(ctx) {
			const [{ getMnemonic }, { loadProofKeys }, { proveSwapInitiate }, { HttpRefereeClient }] = await Promise.all([
				import('$lib/stores/wallet.svelte'),
				import('./swap-runner'),
				import('$lib/extro/prover'),
				import('./referee-client')
			]);
			const mnemonic = await getMnemonic();
			if (!mnemonic) throw new Error('wallet is locked: unlock to prove the swap initiate');
			const { bearerPk, conditionalPk } = await loadProofKeys(fetchFn);
			const envelope = await proveSwapInitiate({ mnemonic, bearerPk, conditionalPk, facts: ctx.facts });
			const referee = new HttpRefereeClient({
				baseUrl: cfg().referee_url,
				pinnedPubkeyHex: cfg().referee_vk_hex,
				fetchFn
			});
			const r = await referee.initiate(envelope);
			return { swapId: r.swap_id, phase: r.phase };
		},
		async advance(swapId) {
			const { HttpRefereeClient } = await import('./referee-client');
			const referee = new HttpRefereeClient({
				baseUrl: cfg().referee_url,
				pinnedPubkeyHex: cfg().referee_vk_hex,
				fetchFn
			});
			const r = await referee.advance(swapId);
			return { phase: r.phase, terminal: r.terminal };
		},
		async bearerSpent(publicWebcash) {
			const rail = new ExtroWebcashRailClient({
				baseUrl: cfg().webcash_server_url,
				tokenStatus: deps.tokenStatus
			});
			return (await rail.healthCheck([publicWebcash]))[publicWebcash].status === 'spent';
		},
		async awaitReleaseSettle(ctx) {
			const rel = await pull().release(ctx.swapId);
			if (!rel.release || rel.release.kind !== 'release-settle') return null;
			const payload = await verifyRefereePush(rel.release, {
				refereeVkHex: cfg().referee_vk_hex,
				swapId: ctx.swapId,
				kind: 'release-settle',
				recipientFpHex: ctx.selfFpHex
			});
			const release = parseReleaseSettle(payload);
			const sealed = unframeConditionalPayload(base64ToBytes(release.providerEncPartialB64));
			const providerPartialHex = await openProviderPartial(ctx.slot, ctx.swapId, ctx.lockedRef, sealed);
			return { release, providerPartialHex };
		},
		async submitSpend(ctx) {
			const { submitArkSpend } = await import('$lib/ark/settle-tx');
			const { RestArkProvider } = await import('@arkade-os/sdk');
			return submitArkSpend({ ...ctx, provider: new RestArkProvider(cfg().ark_asp_url) });
		}
	};
}
