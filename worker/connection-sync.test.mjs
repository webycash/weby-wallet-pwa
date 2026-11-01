import { describe, expect, it } from 'vitest';
import vector from '@extro/node/vectors/connection_sync.json' with { type: 'json' };
import worker, { ConnectionSyncRelay } from '../dev-worker.js';

const HOME = 'https://dev.extro.network';
const BASE = '/wallet';

/** An in-memory Durable Object namespace around the real ConnectionSyncRelay. */
function namespace() {
  const objects = new Map();
  return {
    objects,
    idFromName: (name) => name,
    get(id) {
      if (!objects.has(id)) {
        const data = new Map();
        const storage = {
          get: async (k) => data.get(k),
          put: async (k, v) => void data.set(k, v),
          list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)))
        };
        objects.set(id, new ConnectionSyncRelay({ storage }));
      }
      const obj = objects.get(id);
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
    }
  };
}

const env = (binding = namespace()) => ({ WALLET_BASE_PATH: BASE, CONNECTION_SYNC: binding, ASSETS: { fetch: () => new Response('asset') } });
const item = (i) => {
  const { signing_bytes_hex: _, ...wire } = vector.items[i];
  return wire;
};
const call = (e, action, body, origin = HOME, method = 'POST') =>
  worker.fetch(
    new Request(`${HOME}${BASE}/api/connections/${action}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: method === 'POST' ? JSON.stringify(body) : undefined
    }),
    e
  );
const push = { verifying_key_hex: vector.verifying_key_hex, items: [item(0), item(1)] };
const read = { verifying_key_hex: vector.verifying_key_hex, at: vector.read.at, sig_hex: vector.read.sig_hex };

describe('connection sync relay route', () => {
  it('is 501 without the Durable Object binding (the wallet shows "sync unavailable")', async () => {
    const res = await call({ ...env(), CONNECTION_SYNC: undefined }, 'push', push);
    expect(res.status).toBe(501);
  });

  it('serves only same-origin POSTs', async () => {
    expect((await call(env(), 'push', push, 'https://dev.weby.cash')).status).toBe(403);
    expect((await call(env(), 'push', push, HOME, 'GET')).status).toBe(405);
    expect((await call(env(), 'push', { ...push, verifying_key_hex: 'XY' })).status).toBe(400);
  });

  it('stores verified items per identity; reads need the identity signature', async () => {
    const binding = namespace();
    const e = env(binding);
    const stored = await call(e, 'push', push);
    expect(stored.status).toBe(200);
    expect(await stored.json()).toEqual({ stored: 2 });
    expect([...binding.objects.keys()]).toEqual([vector.verifying_key_hex]);
    // The read window is a transport check around the relay clock.
    const now = Date.now;
    Date.now = () => vector.read.at * 1000;
    try {
      const res = await call(e, 'pull', read);
      expect(res.status).toBe(200);
      expect((await res.json()).items).toHaveLength(2);
      expect((await call(e, 'pull', { ...read, sig_hex: '00'.repeat(64) })).status).toBe(403);
    } finally {
      Date.now = now;
    }
    const forged = { ...push, items: [{ ...item(0), state: 'revoked' }] };
    expect((await call(e, 'push', forged)).status).toBe(403);
  });

  it('carries the security headers and never caches', async () => {
    const res = await call({ ...env(), CONNECTION_SYNC: undefined }, 'pull', read);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
