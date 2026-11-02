import { describe, expect, it } from 'vitest';
import worker from '../dev-worker.js';
import { isOgRequest } from './og-crawlers.mjs';

const WHATSAPP = 'WhatsApp/2.23.20.0';
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

function env({ og = true } = {}) {
  const calls = { og: [], assets: [] };
  const e = {
    WALLET_BASE_PATH: '/wallet',
    ASSETS: {
      async fetch(req) {
        calls.assets.push(new URL(req.url).pathname);
        return new Response('<!doctype html><title>wallet</title>', { headers: { 'content-type': 'text/html' } });
      }
    }
  };
  if (og) {
    e.OG_CARDS = {
      async fetch(req) {
        calls.og.push(req.url);
        return new Response('card', { headers: { 'content-type': 'text/html' } });
      }
    };
  }
  return { e, calls };
}

const get = (path, ua, e) => worker.fetch(new Request(`https://weby.cash${path}`, { headers: { 'user-agent': ua } }), e);

describe('payment-link OG cards (weby.cash/wallet)', () => {
  it('hands card images to the OG Worker', async () => {
    const { e, calls } = env();
    await get('/wallet/og-card.png?amount=1&spent=0', BROWSER, e);
    await get('/wallet/og.png', BROWSER, e);
    expect(calls.og).toHaveLength(2);
    expect(calls.assets).toHaveLength(0);
  });

  it('hands a crawler fetching a payment link to the OG Worker', async () => {
    const { e, calls } = env();
    const res = await get('/wallet?amount=0.5&memo=Thanks', WHATSAPP, e);
    expect(await res.text()).toBe('card');
    expect(calls.og).toEqual(['https://weby.cash/wallet?amount=0.5&memo=Thanks']);
    // Still under the wallet's security headers.
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('serves the wallet to a person opening the same link', async () => {
    const { e, calls } = env();
    await get('/wallet?amount=0.5&memo=Thanks', BROWSER, e);
    expect(calls.og).toHaveLength(0);
    expect(calls.assets.length).toBeGreaterThan(0);
  });

  it('serves the wallet to a crawler on a page that is not a payment link', async () => {
    const { e, calls } = env();
    await get('/wallet/', WHATSAPP, e);
    expect(calls.og).toHaveLength(0);
  });

  it('tiers without the binding never hand anything off', async () => {
    const { e, calls } = env({ og: false });
    await get('/wallet/og.png', BROWSER, e);
    await get('/wallet?amount=1', WHATSAPP, e);
    expect(calls.assets.length).toBeGreaterThan(0);
  });

  it('matches only the base path card names', () => {
    expect(isOgRequest(new URL('https://weby.cash/wallet/og.png'), '', '/wallet')).toBe(true);
    expect(isOgRequest(new URL('https://weby.cash/other/og.png'), '', '/wallet')).toBe(false);
    expect(isOgRequest(new URL('https://weby.cash/wallet?amount=1'), '', '/wallet')).toBe(false);
  });
});
