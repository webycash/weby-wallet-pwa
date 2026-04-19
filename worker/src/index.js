/**
 * Cloudflare Worker — Dynamic OG card for webcash payment links.
 *
 * When a social crawler (WhatsApp, iMessage, X, Telegram, etc.) fetches
 * a payment link like /wallet?amount=0.5&memo=Thanks, this worker returns
 * HTML with dynamic OG meta tags + a dynamically generated PNG gift-card
 * image showing the exact amount.
 *
 * Deploy:
 *   cd worker && npx wrangler deploy
 *
 * Route in Cloudflare dashboard:
 *   weby.cash/wallet*
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import interBold from './Inter-Bold.woff2';
import interRegular from './Inter-Regular.woff2';

import { LOGO_CIRCLE, LOGO_TEXT } from './logo.js';

let wasmReady = false;

const ORIGIN = 'https://webycash.github.io';

const BOTS = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|Applebot|iMessageLinkPreviews|Googlebot|bingbot/i;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function giftCardSvg(amount, memo) {
  const memoLine = memo
    ? `<text x="600" y="440" text-anchor="middle" font-size="48" font-weight="400"
           font-family="Inter,sans-serif" fill="#001BA4" opacity="0.5">"${esc(memo.slice(0, 40))}"</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#ffffff"/>

  <!-- Webycash logo top-left -->
  <svg x="36" y="28" width="140" height="140" viewBox="0 0 1024 1024">
    ${LOGO_CIRCLE}
    ${LOGO_TEXT}
  </svg>

  <!-- Redeem top-right -->
  <text x="1152" y="100" text-anchor="end" font-size="56" font-weight="600"
        font-family="Inter,sans-serif" fill="#001BA4" opacity="0.35" letter-spacing="5">REDEEM</text>

  <!-- Amount then symbol -->
  <text x="600" y="340" text-anchor="middle" font-size="140" font-weight="700"
        font-family="Inter,sans-serif" fill="#001BA4" letter-spacing="-3">${esc(amount)}  &#x20A9;</text>

  ${memoLine}

  <!-- Website bottom center -->
  <text x="600" y="580" text-anchor="middle" font-size="42" font-weight="600"
        font-family="Inter,sans-serif" fill="#001BA4" opacity="0.3">weby.cash</text>
</svg>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ua = request.headers.get('user-agent') || '';

    // --- Serve dynamic OG image ---
    if (url.pathname === '/wallet/og-card.png') {
      const amount = url.searchParams.get('amount') || '?';
      const memo = url.searchParams.get('memo') || '';

      if (!wasmReady) {
        await initWasm(resvgWasm);
        wasmReady = true;
      }

      const svg = giftCardSvg(amount, memo);
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: {
          fontBuffers: [new Uint8Array(interBold), new Uint8Array(interRegular)],
          defaultFontFamily: 'Inter',
        },
      });
      const png = resvg.render().asPng();

      return new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        },
      });
    }

    // --- Bot detection: return dynamic OG HTML ---
    if (BOTS.test(ua) && url.searchParams.has('amount')) {
      const amount = url.searchParams.get('amount') || '?';
      const memo = url.searchParams.get('memo') || '';
      const pageUrl = `https://weby.cash${url.pathname}${url.search}`;
      const imgUrl = `https://weby.cash/wallet/og-card.png?amount=${encodeURIComponent(amount)}${memo ? '&memo=' + encodeURIComponent(memo) : ''}`;
      const title = `You received ${amount} webcash`;
      const desc = memo ? `"${memo}" — Open to redeem` : 'Open to redeem';

      const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Weby Wallet"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${esc(imgUrl)}"/>
<meta property="og:image:secure_url" content="${esc(imgUrl)}"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${esc(pageUrl)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(imgUrl)}"/>
<meta http-equiv="refresh" content="0;url=${esc(pageUrl)}"/>
</head><body></body></html>`;

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // --- Pass through to origin for real users ---
    // Map /wallet/... to /weby-wallet-pwa/... on GitHub Pages
    const originPath = url.pathname.replace(/^\/wallet/, '/weby-wallet-pwa');
    const originUrl = new URL(originPath + url.search, ORIGIN);
    const res = await fetch(originUrl, {
      headers: request.headers,
      redirect: 'follow',
    });

    // Clone response so we can modify headers
    const newRes = new Response(res.body, res);
    newRes.headers.set('X-Robots-Tag', 'noindex');
    return newRes;
  },
};
