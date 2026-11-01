// dev-worker.js /wallet/runtime-config.json TURN paths fail closed
// (pentest 2026-11-01 item 4): no static credential outside development, no
// minting without the rate limiter, and refusals never echo details.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../dev-worker.js';

const URL_ = 'https://w.example/wallet/runtime-config.json';
const req = () => new Request(URL_, { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
const base = {
  WALLET_BASE_PATH: '/wallet',
  PUBLIC_DEPLOYMENT: 'staging',
  PUBLIC_TURN_PROVIDER: 'cloudflare',
  PUBLIC_TURN_TTL_SECONDS: '43200',
  TURN_KEY_ID: 'kid',
  TURN_KEY_API_TOKEN: 'secret-token-value',
  ASSETS: { fetch: async () => new Response('x', { status: 404 }) }
};
const allow = { limit: vi.fn(async () => ({ success: true })) };

async function refused(env, status) {
  const res = await worker.fetch(req(), env);
  expect(res.status).toBe(status);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: 'runtime config unavailable' });
  expect(text).not.toContain('secret-token-value');
  expect(res.headers.get('cache-control')).toBe('no-store');
}

afterEach(() => vi.unstubAllGlobals());

describe('runtime-config TURN fails closed', () => {
  it('refuses to mint when the TURN_MINT_LIMITER binding is missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await refused({ ...base }, 500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('429 when the per-IP mint limit is hit, without calling Cloudflare', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    await refused({ ...base, TURN_MINT_LIMITER: limiter }, 429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when the mint fails upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await refused({ ...base, TURN_MINT_LIMITER: allow }, 500);
  });

  it('refuses a static TURN credential outside development', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const PUBLIC_DEPLOYMENT of ['staging', 'production']) {
      await refused(
        { ...base, PUBLIC_DEPLOYMENT, PUBLIC_TURN_PROVIDER: 'static', PUBLIC_TURN_SERVERS_JSON: '[{"url":"turn:x","username":"u","credential":"c"}]' },
        500
      );
    }
  });

  it('refuses an unknown provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await refused({ ...base, PUBLIC_TURN_PROVIDER: 'other' }, 500);
  });
});
