// Browser security headers for every response of the wallet worker
// (dev-worker.js): pentest 2026-11-01 L3 found the staging/prod wallet served
// no CSP, no frame-ancestors, no nosniff and no Referrer-Policy.
//
// CSP notes:
// - script-src is 'self' plus the sha256 of each inline <script> in the HTML
//   being served (the theme bootstrap and SvelteKit's start block), so it
//   tracks rebuilds without unsafe-inline. 'wasm-unsafe-eval' is for the
//   prover / Ark WASM; no eval/new Function is allowed.
// - connect-src is https:/wss: because the rail endpoints (referee, keyserver,
//   webcash, Ark, explorers, signalling) come from the tier's runtime config.
// - frame-ancestors 'none' (and X-Frame-Options DENY for old browsers):
//   the wallet is never framed.

export const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
});

/** sha256 CSP sources for each inline (src-less) <script> in `html`. */
export async function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(m[1] ?? '')) continue;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[2]));
    out.push(`'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`);
  }
  return out;
}

/** The Content-Security-Policy for a document with these inline-script hashes. */
export function contentSecurityPolicy(scriptHashes = []) {
  return [
    "default-src 'self'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...scriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

/**
 * `res` with the security headers set. HTML bodies get a CSP carrying their
 * inline-script hashes. A 304 keeps the browser's stored CSP (a hash-less
 * policy on a revalidation would replace it and block the inline scripts).
 */
export async function withSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) headers.set(k, v);
  const html = (headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');
  if (!html) {
    headers.set('Content-Security-Policy', contentSecurityPolicy());
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  if (res.status === 304 || res.body === null) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  const text = await res.text();
  headers.set('Content-Security-Policy', contentSecurityPolicy(await inlineScriptHashes(text)));
  headers.delete('Content-Length');
  return new Response(text, { status: res.status, statusText: res.statusText, headers });
}
