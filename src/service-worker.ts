/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';
import {
	EXCHANGE_PUSH_MSG,
	isValidKeyserverPayload,
	toPushMessage,
	type ExchangePushMessage
} from '$lib/modules/webycash-exchange/push-transport';

const CACHE = `weby-wallet-v${version}`;

// All build artifacts (JS chunks, WASM, CSS) + static files (icons, manifest).
// SvelteKit populates these from the build output automatically.
const PRECACHE = [...build, ...files];

// Install: precache the entire app shell + WASM so it works offline.
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
	);
});

// Activate: delete old caches from previous versions.
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

// ── Webycash exchange push routing ───────────────────────────────────────────
//
// Keyserver push messages for the exchange module are received here, validated,
// reduced to SAFE METADATA (the SW never sees or stores a plaintext secret),
// and relayed to app clients. The app's PushHookRouter performs the
// authoritative dedupe by (swap_id, kind, payload_hash), queues while the wallet
// is locked, and dispatches to extro-node hooks. Push delivery is NOT treated
// as proof of processing — that is the wallet's signed-ack job.
//
// A small SW-level dedupe (best-effort, bounded) suppresses an immediate burst
// of identical redeliveries so clients are not spammed; it is not a substitute
// for the app-side dedupe.
const swSeen = new Set<string>();
const swSeenOrder: string[] = [];
const SW_SEEN_MAX = 256;

const swDedupe = (key: string): boolean => {
	if (swSeen.has(key)) return true;
	swSeen.add(key);
	swSeenOrder.push(key);
	if (swSeenOrder.length > SW_SEEN_MAX) {
		const evicted = swSeenOrder.shift();
		if (evicted) swSeen.delete(evicted);
	}
	return false;
};

const relayToClients = async (msg: ExchangePushMessage): Promise<void> => {
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of clients) client.postMessage(msg);
};

const NOTIF_ICON = '/web-app-manifest-192x192.png';

self.addEventListener('push', (event) => {
	let payload: unknown;
	try {
		payload = event.data?.json();
	} catch {
		return; // not JSON / not for us
	}
	if (!payload || typeof payload !== 'object') return;

	// Generic notification shape (from the push dispatch Worker `/api/push/send`):
	// { title, body, tag, icon, url, data }. Show it directly. Chrome requires a
	// visible notification per push under `userVisibleOnly: true`.
	const generic = payload as {
		title?: unknown;
		body?: unknown;
		tag?: unknown;
		icon?: unknown;
		url?: unknown;
		data?: unknown;
	};
	if (typeof generic.title === 'string') {
		const data =
			generic.data && typeof generic.data === 'object'
				? generic.data
				: { url: typeof generic.url === 'string' ? generic.url : '/wallet' };
		event.waitUntil(
			self.registration.showNotification(generic.title, {
				body: typeof generic.body === 'string' ? generic.body : '',
				icon: typeof generic.icon === 'string' ? generic.icon : NOTIF_ICON,
				tag: typeof generic.tag === 'string' ? generic.tag : undefined,
				data
			})
		);
		return;
	}

	// Keyserver-shaped settlement payload: relay to open clients for the in-app
	// router AND show an OS notification so a closed/backgrounded wallet still
	// surfaces the update.
	if (!isValidKeyserverPayload(payload)) return;
	const burstKey = `${payload.swap_id}:${payload.kind}:${payload.signed_payload}`;
	if (swDedupe(burstKey)) return; // best-effort SW dedupe; app does the authoritative one
	const message = toPushMessage(payload);
	event.waitUntil(
		Promise.all([
			relayToClients({ type: EXCHANGE_PUSH_MSG, message }),
			self.registration.showNotification('weby.cash · swap update', {
				body: `Settlement ${String(payload.kind).replace(/_/g, ' ')}`,
				icon: NOTIF_ICON,
				tag: `swap-${payload.swap_id}`,
				data: { url: '/wallet' }
			})
		])
	);
});

// Focus an existing wallet window on tap, else open one at the target URL.
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const data = event.notification.data as { url?: string } | undefined;
	const target = data?.url || '/wallet';
	event.waitUntil(
		(async () => {
			const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of all) {
				if ('focus' in client) {
					await client.focus();
					return;
				}
			}
			if (self.clients.openWindow) await self.clients.openWindow(target);
		})()
	);
});

// Allow clients to ask the SW to re-establish control / skip waiting.
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Fetch: cache-first for precached assets, network-first for API calls.
self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Skip non-GET and cross-origin requests.
	if (request.method !== 'GET') return;
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		caches.match(request).then((cached) => {
			if (cached) return cached;
			// Not in cache — try network, cache the response for next time.
			return fetch(request).then((response) => {
				if (response.ok && response.type === 'basic') {
					const clone = response.clone();
					caches.open(CACHE).then((cache) => cache.put(request, clone));
				}
				return response;
			});
		})
	);
});
