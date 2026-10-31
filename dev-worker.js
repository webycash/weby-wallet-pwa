// Worker serving the static PWA under /wallet (dev: dev.weby.cash/wallet;
// staging/production: their own wrangler config) and its runtime config.
// Assets live under /wallet/* (built with BASE_PATH=/wallet, nested in the
// asset dir under wallet/). Unmatched client-side routes fall back to the
// SPA shell at /wallet/index.html (adapter-static fallback).
import { mintCloudflareTurnServers } from './worker/turn-relay.mjs';

/** TURN relays for the runtime config. `cloudflare` mints short-lived
 *  credentials per request (mainnet tiers); `static` passes
 *  PUBLIC_TURN_SERVERS_JSON through (development only). */
async function turnServers(env, request, parseArray) {
  switch (env.PUBLIC_TURN_PROVIDER ?? 'static') {
    case 'cloudflare': {
      if (env.TURN_MINT_LIMITER) {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const { success } = await env.TURN_MINT_LIMITER.limit({ key: ip });
        if (!success) throw new HttpError(429, 'TURN credential rate limit exceeded');
      }
      return mintCloudflareTurnServers(env);
    }
    case 'static':
      if (env.PUBLIC_DEPLOYMENT !== 'development') {
        throw new Error('static TURN credentials are development-only');
      }
      return parseArray('PUBLIC_TURN_SERVERS_JSON');
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
    const url = new URL(request.url);
    if (url.pathname === '/wallet/runtime-config.json') {
      const parseArray = (name) => {
        try {
          const value = JSON.parse(env[name]);
          if (!Array.isArray(value)) throw new Error('not an array');
          return value;
        } catch (error) {
          throw new Error(`${name} is invalid JSON: ${error}`);
        }
      };
      const config = {
        schema_version: Number(env.PUBLIC_BOOT_SCHEMA_VERSION),
        deployment: env.PUBLIC_DEPLOYMENT,
        db_name: env.PUBLIC_EXTRO_DB_NAME,
        adapter_mode: env.PUBLIC_EXTRO_ADAPTER,
        keyserver_url: env.PUBLIC_KEYSERVER_URL,
        keyserver_domain: env.PUBLIC_KEYSERVER_DOMAIN,
        keyserver_fingerprint_hex: env.PUBLIC_KEYSERVER_FINGERPRINT,
        keyserver_vk_hex: env.PUBLIC_KEYSERVER_VK,
        referee_url: env.PUBLIC_REFEREE_URL,
        referee_vk_hex: env.PUBLIC_REFEREE_VK,
        webcash_server_url: env.PUBLIC_WEBCASH_SERVER_URL,
        voucher_server_url: env.PUBLIC_VOUCHER_SERVER_URL,
        rgb_server_url: env.PUBLIC_RGB_SERVER_URL,
        rgb_collectible_server_url: env.PUBLIC_RGB_COLLECTIBLE_SERVER_URL,
        ark_enabled: env.PUBLIC_ARK_ENABLED === 'true',
        ark_network: env.PUBLIC_ARK_NETWORK,
        ark_asp_url: env.PUBLIC_ARK_ASP_URL ?? '',
        ark_signer_pk_hex: env.PUBLIC_ARK_SIGNER_PK_HEX ?? '',
        ark_info_digest_hex: env.PUBLIC_ARK_INFO_DIGEST_HEX ?? '',
        ark_checkpoint_tapscript_hex: env.PUBLIC_ARK_CHECKPOINT_TAPSCRIPT_HEX ?? '',
        ark_unilateral_exit_delay: Number(env.PUBLIC_ARK_UNILATERAL_EXIT_DELAY ?? '0'),
        zkp_profile: env.PUBLIC_ZKP_PROFILE,
        zkp_bearer_vk_sha256: env.PUBLIC_ZKP_BEARER_VK_SHA256,
        zkp_conditional_vk_sha256: env.PUBLIC_ZKP_CONDITIONAL_VK_SHA256,
        ice_servers: parseArray('PUBLIC_ICE_SERVERS_JSON'),
        turn_servers: [],
      };
      try {
        config.turn_servers = await turnServers(env, request, parseArray);
      } catch (error) {
        // Fail closed: no runtime config means the wallet refuses to boot (no
        // silent fallback to a public relay). The upstream detail is logged, not served.
        console.error(`runtime-config: ${error.message}`);
        const status = error instanceof HttpError ? error.status : 503;
        return Response.json({ error: 'runtime config unavailable' }, { status, headers: NO_STORE });
      }
      return Response.json(config, { headers: NO_STORE });
    }
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;
    const shell = new URL('/wallet/index.html', url.origin);
    return env.ASSETS.fetch(new Request(shell, request));
  }
};
