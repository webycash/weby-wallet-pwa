// DEV-only Worker serving the static PWA at dev.weby.cash/wallet.
// Assets live under /wallet/* (built with BASE_PATH=/wallet, nested in the
// asset dir under wallet/). Unmatched client-side routes fall back to the
// SPA shell at /wallet/index.html (adapter-static fallback).
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
        ark_owner_pk_hex: env.PUBLIC_ARK_OWNER_PK_HEX ?? '',
        zkp_profile: env.PUBLIC_ZKP_PROFILE,
        zkp_bearer_vk_sha256: env.PUBLIC_ZKP_BEARER_VK_SHA256,
        zkp_conditional_vk_sha256: env.PUBLIC_ZKP_CONDITIONAL_VK_SHA256,
        ice_servers: parseArray('PUBLIC_ICE_SERVERS_JSON'),
        turn_servers: parseArray('PUBLIC_TURN_SERVERS_JSON'),
      };
      return Response.json(config, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;
    const shell = new URL('/wallet/index.html', url.origin);
    return env.ASSETS.fetch(new Request(shell, request));
  }
};
