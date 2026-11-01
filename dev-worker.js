// Worker serving the static PWA under its tier's WALLET_BASE_PATH (the one
// source in wrangler.<tier>.toml, also used by the build) and its runtime
// config. Assets live under <base>/* (built with WALLET_TIER=<tier>, nested in
// the asset dir under <base>/). Unmatched client-side routes fall back to the
// SPA shell at <base>/index.html (adapter-static fallback). No base path
// configured = fail closed (nothing is served).
import { parseRuntimeConfig, runtimeConfigFromPublicEnv } from '@extro/node/runtime-config';
import { openerPolicy, withSecurityHeaders } from './worker/security-headers.mjs';
import { mintCloudflareTurnServers } from './worker/turn-relay.mjs';

/** TURN relays for the runtime config. `cloudflare` mints short-lived
 *  credentials per request (mainnet tiers); `static` passes
 *  PUBLIC_TURN_SERVERS_JSON through (development only). */
async function turnServers(env, request) {
  switch (env.PUBLIC_TURN_PROVIDER ?? 'static') {
    case 'cloudflare': {
      // Fail closed: minting without the limiter would let anyone drain the
      // TURN key's credentials, so a missing binding refuses the config.
      if (!env.TURN_MINT_LIMITER) throw new Error('TURN_MINT_LIMITER binding is not configured');
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.TURN_MINT_LIMITER.limit({ key: ip });
      if (!success) throw new HttpError(429, 'TURN credential rate limit exceeded');
      return mintCloudflareTurnServers(env);
    }
    case 'static':
      if (env.PUBLIC_DEPLOYMENT !== 'development') {
        throw new Error('static TURN credentials are development-only');
      }
      return null; // runtimeConfigFromPublicEnv maps PUBLIC_TURN_SERVERS_JSON
    default:
      throw new Error(`unknown PUBLIC_TURN_PROVIDER: ${env.PUBLIC_TURN_PROVIDER}`);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export default {
  async fetch(request, env) {
    const coop = openerPolicy(new URL(request.url).pathname, env.WALLET_BASE_PATH);
    return withSecurityHeaders(await route(request, env), { coop });
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const base = env.WALLET_BASE_PATH;
  if (typeof base !== 'string' || !/^\/[a-z0-9][a-z0-9-]*$/.test(base)) {
    console.error('[wallet] refusing to serve: WALLET_BASE_PATH is not configured');
    return new Response('wallet base path not configured', { status: 500, headers: NO_STORE });
  }
  if (url.pathname === `${base}/runtime-config.json`) {
    // Same PUBLIC_* mapping and strict validation the app applies, from
    // @extro/node; an invalid or incomplete tier config is never served.
    // Fail closed: no runtime config means the wallet refuses to boot (no
    // silent fallback to a public relay). Details are logged, not served.
    let config;
    try {
      const minted = await turnServers(env, request);
      const source = runtimeConfigFromPublicEnv(
        minted === null ? env : { ...env, PUBLIC_TURN_SERVERS_JSON: '[]' }
      );
      if (minted !== null) source.turn_servers = minted;
      config = parseRuntimeConfig(source);
    } catch (error) {
      console.error('[runtime-config] refusing to serve:', String(error));
      const status = error instanceof HttpError ? error.status : 500;
      return Response.json({ error: 'runtime config unavailable' }, { status, headers: NO_STORE });
    }
    return Response.json(config, { headers: NO_STORE });
  }
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return res;
  const shell = new URL(`${base}/index.html`, url.origin);
  return env.ASSETS.fetch(new Request(shell, request));
}
