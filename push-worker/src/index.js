// weby.cash Web Push dispatch Worker.
//
// Routes (proxied at dev.weby.cash/api/push/*, prefix stripped here):
//   GET  /vapid-public-key       → { publicKey } for pushManager.subscribe
//   POST /subscribe              → store a browser PushSubscription in D1
//   POST /send   (Bearer authed) → encrypt + VAPID-sign + deliver to subs
//
// Web Push the Cloudflare-specified way: the `web-push` package does the
// RFC 8291 payload encryption + RFC 8292 VAPID JWT under nodejs_compat. The
// browser's service worker (`service-worker.ts`) receives the push and calls
// showNotification — so the device is notified even when the wallet is closed.
import webpush from 'web-push';

const PREFIX = '/api/push';

const json = (obj, status = 200) =>
	new Response(JSON.stringify(obj), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		let path = url.pathname;
		if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || '/';

		// Public VAPID key — the browser needs it to subscribe.
		if (request.method === 'GET' && path === '/vapid-public-key') {
			return json({ publicKey: env.VAPID_PUBLIC_KEY });
		}

		// Persist a browser PushSubscription (idempotent on endpoint).
		if (request.method === 'POST' && path === '/subscribe') {
			let sub;
			try {
				sub = await request.json();
			} catch {
				return json({ error: 'bad json' }, 400);
			}
			const endpoint = sub?.endpoint;
			const p256dh = sub?.keys?.p256dh;
			const auth = sub?.keys?.auth;
			if (!endpoint || !p256dh || !auth) {
				return json({ error: 'invalid subscription' }, 400);
			}
			await env.DB.prepare(
				`INSERT INTO subscriptions (endpoint, p256dh, auth, expiration_time, fingerprint, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(endpoint) DO UPDATE SET
				   p256dh = excluded.p256dh,
				   auth = excluded.auth,
				   expiration_time = excluded.expiration_time,
				   fingerprint = excluded.fingerprint`
			)
				.bind(
					endpoint,
					p256dh,
					auth,
					sub.expirationTime ?? null,
					typeof sub.fingerprint === 'string' ? sub.fingerprint : null,
					Date.now()
				)
				.run();
			return json({ ok: true });
		}

		// Dispatch a push. Bearer-authed so only the backend (settlement plane)
		// can send. `target` (a fingerprint) narrows delivery; omitted = broadcast.
		if (request.method === 'POST' && path === '/send') {
			const authz = request.headers.get('authorization') || '';
			if (!env.PUSH_SEND_TOKEN || authz !== `Bearer ${env.PUSH_SEND_TOKEN}`) {
				return json({ error: 'unauthorized' }, 401);
			}
			let msg;
			try {
				msg = await request.json();
			} catch {
				return json({ error: 'bad json' }, 400);
			}
			webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
			const payload = JSON.stringify({
				title: msg.title ?? 'weby.cash',
				body: msg.body ?? '',
				tag: msg.tag,
				icon: msg.icon,
				url: msg.url,
				data: msg.data ?? {}
			});

			const query =
				typeof msg.target === 'string'
					? env.DB.prepare(
							'SELECT endpoint, p256dh, auth FROM subscriptions WHERE fingerprint = ?'
						).bind(msg.target)
					: env.DB.prepare('SELECT endpoint, p256dh, auth FROM subscriptions');
			const rows = (await query.all()).results ?? [];

			let sent = 0;
			const dead = [];
			await Promise.all(
				rows.map(async (r) => {
					const sub = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } };
					try {
						await webpush.sendNotification(sub, payload);
						sent++;
					} catch (err) {
						const code = err?.statusCode ?? 0;
						// 404/410 = the subscription is gone; prune it.
						if (code === 404 || code === 410) dead.push(r.endpoint);
					}
				})
			);
			for (const ep of dead) {
				await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(ep).run();
			}
			return json({ ok: true, sent, pruned: dead.length, total: rows.length });
		}

		return json({ error: 'not found', path }, 404);
	}
};
