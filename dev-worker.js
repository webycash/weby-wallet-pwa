// DEV-only Worker serving the static PWA at dev.weby.cash/wallet.
// Assets live under /wallet/* (built with BASE_PATH=/wallet, nested in the
// asset dir under wallet/). Unmatched client-side routes fall back to the
// SPA shell at /wallet/index.html (adapter-static fallback).
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;
    const url = new URL(request.url);
    const shell = new URL('/wallet/index.html', url.origin);
    return env.ASSETS.fetch(new Request(shell, request));
  }
};
