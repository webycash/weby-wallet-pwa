/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

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
