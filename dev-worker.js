// DEV-only Worker serving the static PWA at dev.weby.cash/wallet.
// Assets live under /wallet/* (built with BASE_PATH=/wallet, nested in the
// asset dir under wallet/). Unmatched client-side routes fall back to the
// SPA shell at /wallet/index.html (adapter-static fallback).
import { parseRuntimeConfig, runtimeConfigFromPublicEnv } from '@extro/node/runtime-config';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/wallet/runtime-config.json') {
      // Same PUBLIC_* mapping and strict validation the app applies, from
      // @extro/node; an invalid or incomplete tier config is never served.
      let config;
      try {
        config = parseRuntimeConfig(runtimeConfigFromPublicEnv(env));
      } catch (error) {
        console.error('[runtime-config] refusing to serve:', String(error));
        return new Response('runtime configuration is invalid', {
          status: 500,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
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
