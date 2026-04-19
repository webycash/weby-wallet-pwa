/**
 * Cloudflare Worker — Dynamic OG meta for social previews.
 *
 * Deploy: wrangler deploy worker/og-worker.js --name weby-og
 * Route:  weby.cash/wallet* (in Cloudflare dashboard)
 *
 * When a social crawler (WhatsApp, iMessage, X, Facebook, Telegram, etc.)
 * fetches a payment link like /wallet?amount=0.5&memo=Thanks, this worker
 * returns a minimal HTML page with dynamic OG tags showing the amount.
 * Real browsers get passed through to the origin (GitHub Pages).
 */

const ORIGIN = 'https://webycash.github.io';
const BASE = '/wallet';

const BOTS = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|Applebot|Googlebot|bingbot|iMessageLinkPreviews/i;

export default {
  async fetch(request) {
    const ua = request.headers.get('user-agent') || '';
    const url = new URL(request.url);

    // Only intercept bots on the wallet page with payment params
    if (!BOTS.test(ua) || !url.searchParams.has('amount')) {
      // Pass through to origin
      const originUrl = new URL(url.pathname + url.search, ORIGIN);
      return fetch(originUrl, { headers: request.headers });
    }

    const amount = url.searchParams.get('amount') || '?';
    const memo = url.searchParams.get('memo') || '';
    const symbol = '₩';
    const title = `You received ${symbol}${amount} webcash`;
    const description = memo ? `"${memo}" — Open to claim` : 'Open to claim it in your wallet';
    const pageUrl = `https://weby.cash${url.pathname}${url.search}`;

    // Dynamic SVG OG image (encoded inline as data URI won't work for OG,
    // so we serve it from a path and intercept that too)
    if (url.pathname === `${BASE}/og-dynamic.svg`) {
      const svg = ogSvg(amount, memo);
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const ogImage = `https://weby.cash${BASE}/og-dynamic.svg?amount=${encodeURIComponent(amount)}&memo=${encodeURIComponent(memo)}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Weby Wallet"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${esc(pageUrl)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${esc(ogImage)}"/>
<meta http-equiv="refresh" content="0;url=${esc(pageUrl)}"/>
</head>
<body></body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  },
};

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ogSvg(amount, memo) {
  const symbol = '₩';
  const subtitle = memo ? `"${esc(memo)}"` : 'Open to claim it in your wallet';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#080B14"/>
      <stop offset="100%" stop-color="#0D1220"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="600" cy="200" r="52" stroke="#055DFF" stroke-width="3" fill="none"/>
  <text x="600" y="220" text-anchor="middle" font-size="42" font-weight="700" font-family="system-ui,sans-serif" fill="#055DFF">W</text>
  <text x="600" y="330" text-anchor="middle" font-size="22" font-weight="400" font-family="system-ui,sans-serif" fill="#6B7A99">You received</text>
  <text x="600" y="400" text-anchor="middle" font-size="64" font-weight="700" font-family="system-ui,sans-serif" fill="#E8ECF4">${symbol}${esc(amount)}</text>
  <text x="600" y="460" text-anchor="middle" font-size="20" font-weight="400" font-family="system-ui,sans-serif" fill="#6B7A99">${subtitle}</text>
  <text x="600" y="560" text-anchor="middle" font-size="16" font-weight="500" font-family="system-ui,sans-serif" fill="#3A4560">weby.cash</text>
</svg>`;
}
