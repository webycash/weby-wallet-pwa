// App-side push wiring — connects service-worker push relays to the
// PushHookRouter, and exposes the queued-hook count reactively for the UI.
//
// Lifecycle:
//   * `initPushRouter(isUnlocked)` installs a `navigator.serviceWorker` message
//     listener that routes each relayed push through the router.
//   * While the wallet is LOCKED the router queues SAFE METADATA only.
//   * `replayPushQueue()` is called after unlock to drain the queue.
//
// SECRECY: nothing here decrypts; the router only ever holds commitments. The
// reactive surface exposes counts/labels, never payloads.

import { getExtroClient } from '$lib/extro';
import { PushHookRouter, type SignedAck } from './push-hooks';
import { isExchangePushMessage } from './push-transport';

interface PushState {
	queuedCount: number;
	lastAckAt: number | null;
	/** Oldest queued-at timestamp, for the "queued too long" risk surface. */
	oldestQueuedAt: number | null;
}

const state = $state<PushState>({ queuedCount: 0, lastAckAt: null, oldestQueuedAt: null });

let router: PushHookRouter | null = null;
let unlockedFn: () => boolean = () => false;
let listening = false;

const syncCounts = () => {
	state.queuedCount = router?.queuedCount ?? 0;
	state.oldestQueuedAt = router?.queued[0]?.queuedAt ?? null;
};

const onAck = (_ack: SignedAck) => {
	state.lastAckAt = Math.floor(Date.now() / 1000);
};

/**
 * Install (once) the router + the service-worker message listener.
 * `isUnlocked` is read live on each push so lock-state changes are respected
 * without re-init.
 */
export function initPushRouter(isUnlocked: () => boolean): void {
	unlockedFn = isUnlocked;
	if (!router) {
		router = new PushHookRouter({
			client: getExtroClient(),
			isUnlocked: () => unlockedFn(),
			onAck
		});
	}
	if (listening || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
	navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
		if (!isExchangePushMessage(event.data)) return;
		void router!.route(event.data.message).then(syncCounts);
	});
	listening = true;
}

/** Drain queued hooks after the wallet unlocks. */
export async function replayPushQueue(): Promise<void> {
	if (!router) return;
	await router.replayQueued();
	syncCounts();
}

export const pushStatus = {
	get queuedCount() {
		return state.queuedCount;
	},
	get lastAckAt() {
		return state.lastAckAt;
	},
	/** Seconds the oldest queued hook has waited (0 when none). */
	get queuedAgeSec() {
		return state.oldestQueuedAt === null ? 0 : Math.max(0, Math.floor(Date.now() / 1000) - state.oldestQueuedAt);
	}
};

/** Test/manual hook: route a message directly (bypassing the SW transport). */
export async function routeDirect(...args: Parameters<PushHookRouter['route']>) {
	if (!router) initPushRouter(unlockedFn);
	const r = await router!.route(...args);
	syncCounts();
	return r;
}
