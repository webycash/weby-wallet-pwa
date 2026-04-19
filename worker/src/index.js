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

let wasmReady = false;

const ORIGIN = 'https://webycash.github.io/weby-wallet-pwa';

const BOTS = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|Applebot|iMessageLinkPreviews|Googlebot|bingbot/i;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function giftCardSvg(amount, memo) {
  const memoLine = memo
    ? `<text x="600" y="460" text-anchor="middle" font-size="16" font-weight="400"
           font-family="Arial,Helvetica,sans-serif" fill="#3a4a6a">"${esc(memo.slice(0, 60))}"</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#0f1118"/>
      <stop offset="100%" stop-color="#0b0d14"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="40%">
      <stop offset="0%" stop-color="#055DFF" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#055DFF" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Logo top-left -->
  <circle cx="56" cy="46" r="16" stroke="#055DFF" stroke-width="1.5" fill="none" opacity="0.4"/>
  <text x="56" y="52" text-anchor="middle" font-size="14" font-weight="700"
        font-family="Arial,Helvetica,sans-serif" fill="#055DFF" opacity="0.4">W</text>

  <!-- Amount -->
  <text x="600" y="350" text-anchor="middle" font-size="160" font-weight="700"
        font-family="Arial,Helvetica,sans-serif" fill="#e4e8f0" letter-spacing="-4">${esc(amount)}</text>

  <!-- Currency -->
  <text x="600" y="410" text-anchor="middle" font-size="20" font-weight="500"
        font-family="Arial,Helvetica,sans-serif" fill="#055DFF" opacity="0.6" letter-spacing="4">WEBCASH</text>

  ${memoLine}

  <!-- Redeem bottom-right -->
  <text x="1150" y="600" text-anchor="end" font-size="12" font-weight="500"
        font-family="Arial,Helvetica,sans-serif" fill="#3a4a6a" letter-spacing="2">REDEEM</text>
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
      const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
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
    const originUrl = new URL(url.pathname + url.search, ORIGIN);
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
