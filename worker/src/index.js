/**
 * Cloudflare Worker — Dynamic OG card for webcash payment links.
 *
 * When a social crawler (WhatsApp, iMessage, X, Telegram, etc.) fetches
 * a payment link like /wallet?amount=0.5&memo=Thanks, this worker returns
 * HTML with dynamic OG meta tags + a dynamically generated PNG gift-card
 * image showing the exact amount.
 *
 * The worker verifies webcash against the webcash.org API:
 * - Valid (unspent) -> card shows "REDEEM"
 * - Spent -> card shows "INVALID"
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

// --- Webcash verification helpers ---
// The worker never handles secrets — it receives the pre-computed public
// webcash string (e.g. "e1.00000000:public:hash...") from the client and
// passes it directly to the read-only health_check endpoint.

function apiUrl(network) {
  return network === 'testnet'
    ? 'https://weby.cash/api/webcash/testnet/api/v1'
    : 'https://webcash.org/api/v1';
}

async function checkSpent(network, publicWc) {
  if (!publicWc) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(`${apiUrl(network)}/health_check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([publicWc]),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[publicWc];
    if (!result || result.spent === null || result.spent === undefined) return null;
    return result.spent;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// --- SVG card generators ---

function giftCardSvg(amount, memo, spent) {
  const memoColor = spent === true ? '#999999' : '#7B4DB8';
  const memoLine = memo
    ? `<text x="600" y="450" text-anchor="middle" font-size="56" font-weight="400"
           font-family="Geist,Inter,sans-serif" fill="${memoColor}" opacity="0.5">"${esc(memo.slice(0, 35))}"</text>`
    : '';

  // Auto-scale amount font size based on character count
  const amountText = `${amount}  \u20A9`;
  const len = amountText.length;
  const fontSize = len <= 6 ? 140 : len <= 9 ? 110 : len <= 12 ? 90 : 72;

  const isInvalid = spent === true;
  const statusText = isInvalid ? 'INVALID' : 'REDEEM';
  const gray = '#999999';
  const purple = '#7B4DB8';
  const color = isInvalid ? gray : purple;

  // For invalid cards: gray logo via SVG filter
  const logoCircle = isInvalid
    ? '<circle cx="512" cy="512" r="413" stroke="' + gray + '" stroke-width="60" fill="none"/>'
    : LOGO_CIRCLE;
  const logoText = isInvalid
    ? LOGO_TEXT.replace(/#7B4DB8/g, gray)
    : LOGO_TEXT;

  // Strikethrough line on amount for invalid cards
  const strikethrough = isInvalid
    ? `<line x1="200" y1="330" x2="1000" y2="330" stroke="${gray}" stroke-width="4" opacity="0.5"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#faf9fc"/>

  <!-- Webycash logo top-left -->
  <g transform="translate(44,28) scale(0.17)">
    ${logoCircle}
    ${logoText}
  </g>

  <!-- Status top-right -->
  <text x="1152" y="100" text-anchor="end" font-size="56" font-weight="600"
        font-family="Geist,Inter,sans-serif" fill="${color}" opacity="${isInvalid ? '0.5' : '0.35'}" letter-spacing="5">${statusText}</text>

  <!-- Amount then symbol -->
  <text x="600" y="340" text-anchor="middle" font-size="${fontSize}" font-weight="700"
        font-family="Geist,Inter,sans-serif" fill="${color}" letter-spacing="-3">${esc(amount)}  &#x20A9;</text>
  ${strikethrough}

  ${memoLine}

  <!-- Website bottom center -->
  <text x="600" y="580" text-anchor="middle" font-size="42" font-weight="600"
        font-family="Geist,Inter,sans-serif" fill="${color}" opacity="0.3">weby.cash</text>
</svg>`;
}

function genericCardSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#faf9fc"/>

  <!-- Webycash logo left, vertically centered -->
  <g transform="translate(60,228) scale(0.20)">
    ${LOGO_CIRCLE}
    ${LOGO_TEXT}
  </g>

  <!-- weby.cash center -->
  <text x="660" y="345" text-anchor="middle" font-size="100" font-weight="700"
        font-family="Geist,Inter,sans-serif" fill="#7B4DB8" letter-spacing="-2">weby.cash</text>
</svg>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ua = request.headers.get('user-agent') || '';

    // --- Serve OG images ---
    // /wallet/og-card.png?amount=X&memo=Y&spent=1 = dynamic per-payment card
    // /wallet/og.png = generic fallback (logo + weby.cash)
    if (url.pathname === '/wallet/og-card.png' || url.pathname === '/wallet/og.png') {
      const isGeneric = url.pathname === '/wallet/og.png';
      const amount = isGeneric ? '' : (url.searchParams.get('amount') || '?');
      const memo = isGeneric ? '' : (url.searchParams.get('memo') || '');
      const spent = !isGeneric && url.searchParams.get('spent') === '1';

      // Check edge cache first — avoids WASM cold start on repeated requests
      const cacheKey = new Request(isGeneric
        ? 'https://og-cache.weby.cash/_generic'
        : `https://og-cache.weby.cash/${amount}/${memo || '_'}/${spent ? 'spent' : 'valid'}`);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      // Generate PNG (cold start: ~2s for WASM init, warm: ~50ms)
      if (!wasmReady) {
        await initWasm(resvgWasm);
        wasmReady = true;
      }

      const svg = isGeneric ? genericCardSvg() : giftCardSvg(amount, memo, spent);
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: {
          fontBuffers: [new Uint8Array(interBold), new Uint8Array(interRegular)],
          defaultFontFamily: 'Geist',
        },
      });
      const png = resvg.render().asPng();

      // Spent cards cache long (permanent state), valid cards cache short (may change)
      const cacheControl = (isGeneric || spent)
        ? 'public, max-age=86400, s-maxage=604800'
        : 'public, max-age=0, s-maxage=300';

      const response = new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': cacheControl,
        },
      });

      // Store in edge cache for instant subsequent fetches
      await cache.put(cacheKey, response.clone());
      return response;
    }

    // --- Handle links with amount (pre-warm & OG for bots) ---
    if (url.searchParams.has('amount')) {
      const amount = url.searchParams.get('amount') || '?';
      const memo = url.searchParams.get('memo') || '';

      // Bots get dynamic OG HTML with webcash verification
      if (BOTS.test(ua)) {
        const pub = url.searchParams.get('pub') || '';
        const network = url.searchParams.get('network') || 'production';

        // Verify public webcash if present — defaults to valid on any error
        const spent = pub ? await checkSpent(network, pub) : null;
        const spentParam = spent === true ? '1' : '0';

        const imgUrl = `https://weby.cash/wallet/og-card.png?amount=${encodeURIComponent(amount)}${memo ? '&memo=' + encodeURIComponent(memo) : ''}&spent=${spentParam}`;

        // Pre-warm the verified image
        ctx.waitUntil(fetch(imgUrl));

        const pageUrl = `https://weby.cash${url.pathname}${url.search}`;
        const title = spent === true
          ? 'This webcash has been redeemed'
          : `You received ${amount} webcash`;
        const desc = spent === true
          ? 'This payment has already been claimed'
          : (memo ? `"${memo}" \u2014 Open to redeem` : 'Open to redeem');

        return new Response(`<!DOCTYPE html>
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
</head><body></body></html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
        });
      }

      // Real users — pre-warm with valid status and fall through to origin
      const imgUrl = `https://weby.cash/wallet/og-card.png?amount=${encodeURIComponent(amount)}${memo ? '&memo=' + encodeURIComponent(memo) : ''}`;
      ctx.waitUntil(fetch(imgUrl));
      // Fall through to origin below
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
