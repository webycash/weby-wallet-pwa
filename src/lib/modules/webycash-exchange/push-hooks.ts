// Push-hook router for the Webycash exchange module.
//
// Inbound keyserver push messages (delivered to the service worker, then to the
// app) are routed here, which forwards them to extro-node wallet hooks through
// the extro facade. This module owns three invariants from the dev-plan:
//
//   1. DEDUPE by (swap_id, kind, payload_hash). A re-delivered push is a no-op.
//   2. LOCKED-WALLET SAFETY. While the wallet is locked we persist ONLY safe
//      metadata — ciphertext, hashes, ids, signatures — and NEVER decrypt. The
//      payload is replayed once the wallet unlocks.
//   3. SIGNED ACK. After a hook is processed (not merely received — push is not
//      proof of processing), an ack callback is invoked so the referee/rail can
//      advance. The ack carries the swap id, kind, and outcome — never a secret.
//
// The module never holds a plaintext bearer secret: a {@link PushMessage}
// carries only commitments. Decryption (when unlocked) happens INSIDE
// extro-node behind the facade, not here.

import type { ExtroClient } from '$lib/extro/client';
import {
	newRequestId,
	type ExtroCommand,
	type HookOutcome,
	type PushKind
} from '$lib/extro/commands';

/**
 * The kinds of push a swap can carry. Mirrors the keyserver push routing in the
 * dev-plan ("Push Hooks") and maps onto extro-node {@link PushKind} /
 * `HookCommand`.
 */
export type HookKind =
	| 'insert' // encrypted bearer payload → Insert
	| 'invalidate' // public-hash invalidation / fail-to-deliver → Invalidate
	| 'release-settle' // ARK settle release
	| 'release-refund' // ARK refund release
	| 'fail-to-deliver'; // explicit fail-to-deliver (also rotates the secret)

/**
 * Safe push metadata. This is ALL the module ever sees or stores — there is no
 * field for a plaintext secret. `signedPayload` is the opaque rkyv `Signed`
 * envelope (base64); the runtime verifies and (if unlocked) decrypts it.
 */
export interface PushMessage {
	/** 16-byte swap id, hex. */
	swapId: string;
	kind: HookKind;
	/** Sender's 32-byte ed25519 verifying key, hex. */
	senderVk: string;
	/** Opaque signed-envelope bytes (rkyv `Signed`), base64. NEVER a secret. */
	signedPayload: string;
	/** SHA-256 of the ciphertext, hex — a commitment, not the plaintext. */
	ciphertextHash?: string;
	/** SHA-256 of the public token, hex (for invalidate/fail-to-deliver). */
	publicTokenHash?: string;
	/** Recipient fingerprint (20 bytes, hex) for delivery kinds. */
	recipientFingerprint?: string;
}

/** A queued message awaiting wallet unlock. Safe metadata only. */
export interface QueuedHook {
	message: PushMessage;
	/** (swap_id, kind, payload_hash) dedupe key. */
	dedupeKey: string;
	queuedAt: number;
}

export type RouteResult =
	| { status: 'processed'; outcome: HookOutcome }
	| { status: 'queued'; reason: 'wallet-locked' }
	| { status: 'duplicate' }
	| { status: 'failed'; code: string; message: string };

/** A redaction-safe signed ack the wallet emits after processing a hook. */
export interface SignedAck {
	swapId: string;
	kind: HookKind;
	outcome: HookOutcome;
}

export interface RouterDeps {
	/** The extro facade client (single-flight). */
	client: ExtroClient;
	/** Whether the wallet is currently unlocked (can decrypt / run key ops). */
	isUnlocked: () => boolean;
	/** Emit a signed ack after a hook is processed. */
	onAck?: (ack: SignedAck) => void | Promise<void>;
	/** Current time source (injectable for tests). */
	now?: () => number;
}

const PUSH_KIND_MAP: Record<HookKind, PushKind> = {
	insert: 'EncryptedDelivery',
	invalidate: 'FailToDeliver',
	'fail-to-deliver': 'FailToDeliver',
	'release-settle': 'ArkSettle',
	'release-refund': 'ArkRefund'
};

/**
 * Stateless-ish push router. Holds the dedupe set and the locked-wallet queue;
 * everything else is delegated to extro-node via the facade.
 */
export class PushHookRouter {
	private readonly deps: RouterDeps;
	/** Seen (swap_id, kind, payload_hash) keys — dedupe across redeliveries. */
	private readonly seen = new Set<string>();
	/** Messages queued because the wallet was locked. Safe metadata only. */
	private readonly queue: QueuedHook[] = [];

	constructor(deps: RouterDeps) {
		this.deps = deps;
	}

	private now(): number {
		return (this.deps.now ?? (() => Math.floor(Date.now() / 1000)))();
	}

	/** Number of messages currently queued for a later unlock. */
	get queuedCount(): number {
		return this.queue.length;
	}

	/** Snapshot of queued messages (safe metadata only). */
	get queued(): readonly QueuedHook[] {
		return this.queue;
	}

	/**
	 * Route one inbound push message. Deduped by (swap_id, kind, payload_hash);
	 * queued (safe metadata only) when locked; otherwise dispatched to the hook
	 * and acked.
	 */
	async route(message: PushMessage): Promise<RouteResult> {
		const dedupeKey = await dedupeKeyFor(message);

		if (this.seen.has(dedupeKey)) {
			return { status: 'duplicate' };
		}

		if (!this.deps.isUnlocked()) {
			// LOCKED: persist safe metadata only. Do NOT mark as seen yet — it has
			// not been processed; it will be processed on unlock. But DO guard
			// against queuing the same message twice.
			if (!this.queue.some((q) => q.dedupeKey === dedupeKey)) {
				this.queue.push({ message, dedupeKey, queuedAt: this.now() });
			}
			return { status: 'queued', reason: 'wallet-locked' };
		}

		return this.process(message, dedupeKey);
	}

	/**
	 * Replay every queued hook (call after the wallet unlocks). Returns the
	 * per-message outcomes in queue order. Processed messages leave the queue.
	 */
	async replayQueued(): Promise<RouteResult[]> {
		if (!this.deps.isUnlocked()) return [];
		const pending = this.queue.splice(0, this.queue.length);
		const results: RouteResult[] = [];
		for (const q of pending) {
			results.push(await this.process(q.message, q.dedupeKey));
		}
		return results;
	}

	private async process(message: PushMessage, dedupeKey: string): Promise<RouteResult> {
		// Mark seen BEFORE dispatch so a concurrent redelivery is deduped even if
		// the dispatch is slow. (Idempotency is also enforced inside extro-node.)
		this.seen.add(dedupeKey);

		const command = this.buildCommand(message);
		const response = await this.deps.client.send(command);

		if (response.kind === 'Err') {
			// On a hard error we DROP the seen mark so a legitimate redelivery can
			// retry. The error is surfaced honestly, never as a fake success.
			this.seen.delete(dedupeKey);
			return { status: 'failed', code: String(response.code), message: response.message };
		}

		const outcome: HookOutcome =
			response.body.kind === 'Hook' ? response.body.outcome : 'Processed';

		// Signed ack: push delivery is not proof of processing; the wallet's own
		// processed outcome is what advances the swap. Never include a secret.
		// (A duplicate, per extro-node, needs no fresh ack.)
		if (outcome === 'Processed') {
			await this.deps.onAck?.({ swapId: message.swapId, kind: message.kind, outcome });
		}

		return { status: 'processed', outcome };
	}

	private buildCommand(message: PushMessage): ExtroCommand {
		const signed = b64ToBytes(message.signedPayload);
		const senderVk = hexToBytes(message.senderVk, 32);
		const swapId = hexToBytes(message.swapId, 16);
		return {
			request_id: newRequestId(),
			op: {
				kind: 'Push',
				cmd: {
					op: 'DispatchPush',
					kind: PUSH_KIND_MAP[message.kind],
					signed_payload: signed,
					sender_vk: senderVk,
					swap_id: swapId
				}
			}
		};
	}
}

// ── Dedupe key ─────────────────────────────────────────────────────────────

/**
 * The dedupe key is `swap_id : kind : payload_hash`, where payload_hash is the
 * SHA-256 of the signed payload bytes. A DIFFERENT payload (e.g. a rotated
 * secret for the same swap+kind) yields a DIFFERENT key and is NOT deduped.
 */
export async function dedupeKeyFor(message: PushMessage): Promise<string> {
	const hash = await sha256Hex(b64ToBytes(message.signedPayload));
	return `${message.swapId}:${message.kind}:${hash}`;
}

// ── Encoding helpers (no secrets pass through here) ──────────────────────────

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		// Copy into a fresh ArrayBuffer-backed view so the digest input is a
		// plain BufferSource (the source may be a subarray over a shared buffer).
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		const digest = await crypto.subtle.digest('SHA-256', copy);
		return bytesToHex(new Uint8Array(digest));
	}
	// Deterministic non-crypto fallback (test/node environments without subtle).
	let h = 0x811c9dc5;
	for (const b of bytes) {
		h ^= b;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

export function bytesToHex(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += x.toString(16).padStart(2, '0');
	return s;
}

export function hexToBytes(hex: string, expectedLen?: number): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const len = clean.length / 2;
	const out = new Uint8Array(expectedLen ?? len);
	for (let i = 0; i < len && i < out.length; i++) {
		out[i] = parseInt(clean.substr(i * 2, 2), 16);
	}
	return out;
}

export function b64ToBytes(b64: string): Uint8Array {
	if (b64 === '') return new Uint8Array(0);
	if (typeof atob === 'function') {
		const bin = atob(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	// Node fallback.
	return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bytesToB64(bytes: Uint8Array): string {
	if (typeof btoa === 'function') {
		let bin = '';
		for (const b of bytes) bin += String.fromCharCode(b);
		return btoa(bin);
	}
	return Buffer.from(bytes).toString('base64');
}
