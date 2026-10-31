import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintCloudflareTurnServers } from './turn-relay.mjs';

const env = { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'tok', PUBLIC_TURN_TTL_SECONDS: '43200' };
const iceServers = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
  {
    urls: [
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turn:turn.cloudflare.com:53?transport=udp',
      'turns:turn.cloudflare.com:5349?transport=tcp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ],
    username: 'u',
    credential: 'c',
  },
];

afterEach(() => vi.unstubAllGlobals());

describe('mintCloudflareTurnServers', () => {
  it('mints per request and keeps only browser-usable turn:/turns: URLs', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ iceServers }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const servers = await mintCloudflareTurnServers(env);
    expect(servers.map((s) => s.url)).toEqual([
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turns:turn.cloudflare.com:5349?transport=tcp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ]);
    expect(servers.every((s) => s.username === 'u' && s.credential === 'c')).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ ttl: 43200 });
  });

  it('fails closed on missing secrets, bad TTL, upstream error, or no relay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));
    await expect(mintCloudflareTurnServers({ ...env, TURN_KEY_API_TOKEN: '' })).rejects.toThrow(/secrets/);
    await expect(mintCloudflareTurnServers({ ...env, PUBLIC_TURN_TTL_SECONDS: '60' })).rejects.toThrow(/TTL/);
    await expect(mintCloudflareTurnServers(env)).rejects.toThrow(/HTTP 401/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ iceServers: [iceServers[0]] }))));
    await expect(mintCloudflareTurnServers(env)).rejects.toThrow(/no usable/);
  });
});
