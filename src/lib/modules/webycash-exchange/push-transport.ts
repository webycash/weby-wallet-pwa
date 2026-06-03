// Service-worker ↔ app push transport contract.
//
// The service worker receives keyserver push messages, extracts SAFE METADATA
// (ciphertext, hashes, ids, signatures — never a plaintext secret), and relays
// it to the app via `postMessage`. The app's {@link PushHookRouter} then
// dedupes, queues (if locked), and dispatches to extro-node hooks.
//
// This module is the shared shape both sides import. It is dependency-free so
// the service-worker bundle (no DOM, no runes) can use it.

import type { HookKind, PushMessage } from './push-hooks';

/** Envelope type tag for messages posted between SW and app. */
export const EXCHANGE_PUSH_MSG = 'webycash-exchange-push';

/** What the keyserver sends in a Web Push `data` payload (JSON). */
export interface KeyserverPushPayload {
	/** Module the push is for; we only handle the exchange module. */
	module: 'webycash-exchange';
	swap_id: string;
	kind: HookKind;
	sender_vk: string;
	/** Opaque signed envelope (rkyv `Signed`), base64. NEVER a secret. */
	signed_payload: string;
	ciphertext_hash?: string;
	public_token_hash?: string;
	recipient_fingerprint?: string;
}

/** Message the SW posts to clients carrying the safe push metadata. */
export interface ExchangePushMessage {
	type: typeof EXCHANGE_PUSH_MSG;
	message: PushMessage;
}

/** Type guard for the SW→app message in the app's `message` handler. */
export function isExchangePushMessage(data: unknown): data is ExchangePushMessage {
	return (
		typeof data === 'object' &&
		data !== null &&
		(data as { type?: unknown }).type === EXCHANGE_PUSH_MSG
	);
}

/**
 * Map a keyserver payload into the SAFE {@link PushMessage} the router accepts.
 * Drops everything not on the allowlist — there is no field through which a
 * plaintext secret could pass.
 */
export function toPushMessage(payload: KeyserverPushPayload): PushMessage {
	return {
		swapId: payload.swap_id,
		kind: payload.kind,
		senderVk: payload.sender_vk,
		signedPayload: payload.signed_payload,
		ciphertextHash: payload.ciphertext_hash,
		publicTokenHash: payload.public_token_hash,
		recipientFingerprint: payload.recipient_fingerprint
	};
}

const VALID_KINDS: ReadonlySet<HookKind> = new Set<HookKind>([
	'insert',
	'invalidate',
	'release-settle',
	'release-refund',
	'fail-to-deliver'
]);

/** Validate a raw push payload before relaying it. */
export function isValidKeyserverPayload(data: unknown): data is KeyserverPushPayload {
	if (typeof data !== 'object' || data === null) return false;
	const p = data as Record<string, unknown>;
	return (
		p.module === 'webycash-exchange' &&
		typeof p.swap_id === 'string' &&
		typeof p.kind === 'string' &&
		VALID_KINDS.has(p.kind as HookKind) &&
		typeof p.sender_vk === 'string' &&
		typeof p.signed_payload === 'string'
	);
}
