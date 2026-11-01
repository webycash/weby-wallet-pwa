import { describe, expect, it } from 'vitest';
import worker from '../dev-worker.js';
import { contentSecurityPolicy, inlineScriptHashes, withSecurityHeaders } from './security-headers.mjs';

const THEME = "(function(){document.documentElement.dataset.t='x'})()";
const BOOT = '{ __sveltekit_x = { base: "/wallet" }; }';
const SHELL = `<!doctype html><html><head><script>${THEME}</script>
<script type="module" src="/wallet/_app/start.js"></script></head>
<body><script>${BOOT}</script></body></html>`;

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return `'sha256-${Buffer.from(d).toString('base64')}'`;
}

function assetsEnv(files) {
  return {
    PUBLIC_TURN_PROVIDER: 'static',
    PUBLIC_DEPLOYMENT: 'staging',
    ASSETS: {
      async fetch(req) {
        const path = new URL(req.url).pathname;
        const f = files[path];
        if (!f) return new Response('not found', { status: 404 });
        return new Response(f.body, { headers: { 'content-type': f.type, 'content-length': String(f.body.length) } });
      }
    }
  };
}

function expectBase(res) {
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/(^|\s)'unsafe-eval'/); // only 'wasm-unsafe-eval'
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'/);
}

describe('wallet worker security headers (pentest 2026-11-01 L3)', () => {
  it('hashes only inline scripts', async () => {
    expect(await inlineScriptHashes(SHELL)).toEqual([await sha(THEME), await sha(BOOT)]);
  });

  it('the CSP never allows unsafe-inline scripts or framing', () => {
    const csp = contentSecurityPolicy(["'sha256-abc'"]);
    const script = csp.split('; ').find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self' 'wasm-unsafe-eval' 'sha256-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('the SPA shell carries the hashes of its own inline scripts', async () => {
    const env = assetsEnv({ '/wallet/index.html': { body: SHELL, type: 'text/html; charset=utf-8' } });
    for (const path of ['/wallet/index.html', '/wallet/some/client/route']) {
      const res = await worker.fetch(new Request(`https://w.example${path}`), env);
      expect(res.status).toBe(200);
      expectBase(res);
      const csp = res.headers.get('content-security-policy');
      expect(csp).toContain(await sha(THEME));
      expect(csp).toContain(await sha(BOOT));
      expect(await res.text()).toBe(SHELL);
    }
  });

  it('static assets get the headers too', async () => {
    const env = assetsEnv({ '/wallet/_app/start.js': { body: 'export {}', type: 'text/javascript' } });
    const res = await worker.fetch(new Request('https://w.example/wallet/_app/start.js'), env);
    expectBase(res);
    expect(await res.text()).toBe('export {}');
  });

  it('a refused runtime config still carries the headers', async () => {
    const env = assetsEnv({});
    const res = await worker.fetch(new Request('https://w.example/wallet/runtime-config.json'), env);
    expect(res.status).toBe(500);
    expectBase(res);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a 304 keeps the stored CSP (no hash-less policy)', async () => {
    const res = await withSecurityHeaders(new Response(null, { status: 304, headers: { 'content-type': 'text/html' } }));
    expect(res.status).toBe(304);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
