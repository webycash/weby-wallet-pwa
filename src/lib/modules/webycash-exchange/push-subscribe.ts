// Browser Web Push subscription — the client half of the VAPID flow.
//
// `enablePush()` requests notification permission, fetches the server VAPID
// public key, subscribes through the service worker's PushManager, and posts
// the resulting PushSubscription to the dispatch Worker (`/api/push/subscribe`,
// same-origin under dev.weby.cash). After this, the backend can deliver a push
// that the service worker turns into an OS notification — even with the wallet
// closed. Nothing secret is sent: a PushSubscription is a delivery address.

const PUSH_BASE = '/api/push';

/** Decode a base64url VAPID key to the bytes `pushManager.subscribe` wants. */
function base64urlToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
	const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
	const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export type EnablePushResult =
	| { ok: true }
	| { ok: false; reason: 'unsupported' | 'denied' | 'no-key' | 'error'; detail?: string };

/** True iff this browser can do Web Push and a SW is controlling the page. */
export function pushSupported(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		'serviceWorker' in navigator &&
		typeof window !== 'undefined' &&
		'PushManager' in window &&
		'Notification' in window
	);
}

/** Whether a push subscription already exists for this browser. */
export async function isPushEnabled(): Promise<boolean> {
	if (!pushSupported()) return false;
	try {
		const reg = await navigator.serviceWorker.ready;
		return !!(await reg.pushManager.getSubscription());
	} catch {
		return false;
	}
}

/**
 * Enable Web Push: permission → VAPID key → subscribe → register with backend.
 * `fingerprint` (the slot-0 identity, hex) lets a settlement push target this
 * wallet specifically; omit to register for broadcast only. Must be called from
 * a user gesture (the permission prompt requires it).
 */
export async function enablePush(fingerprint?: string): Promise<EnablePushResult> {
	if (!pushSupported()) return { ok: false, reason: 'unsupported' };
	try {
		const permission = await Notification.requestPermission();
		if (permission !== 'granted') return { ok: false, reason: 'denied' };

		const keyResp = await fetch(`${PUSH_BASE}/vapid-public-key`);
		if (!keyResp.ok) return { ok: false, reason: 'no-key', detail: `status ${keyResp.status}` };
		const { publicKey } = (await keyResp.json()) as { publicKey?: string };
		if (!publicKey) return { ok: false, reason: 'no-key' };

		const reg = await navigator.serviceWorker.ready;
		const existing = await reg.pushManager.getSubscription();
		const subscription =
			existing ??
			(await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: base64urlToUint8Array(publicKey)
			}));

		const j = subscription.toJSON();
		const resp = await fetch(`${PUSH_BASE}/subscribe`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				endpoint: j.endpoint,
				expirationTime: j.expirationTime ?? null,
				keys: j.keys,
				fingerprint
			})
		});
		if (!resp.ok) return { ok: false, reason: 'error', detail: `subscribe ${resp.status}` };
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
	}
}

/** Unsubscribe locally (the backend prunes the dead endpoint on next send). */
export async function disablePush(): Promise<boolean> {
	if (!pushSupported()) return false;
	try {
		const reg = await navigator.serviceWorker.ready;
		const sub = await reg.pushManager.getSubscription();
		return sub ? await sub.unsubscribe() : true;
	} catch {
		return false;
	}
}
