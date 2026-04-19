/**
 * Generate static OG fallback image (1200x630 PNG).
 * Run: node scripts/gen-og.mjs
 */
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#0f1118"/>
      <stop offset="100%" stop-color="#0b0d14"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="45%" r="35%">
      <stop offset="0%" stop-color="#055DFF" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#055DFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <circle cx="60" cy="50" r="18" stroke="#055DFF" stroke-width="1.5" fill="none" opacity="0.5"/>
  <text x="60" y="57" text-anchor="middle" font-size="16" font-weight="700"
        font-family="Arial,Helvetica,sans-serif" fill="#055DFF" opacity="0.5">W</text>
  <rect x="500" y="120" width="200" height="1" fill="#055DFF" opacity="0.3"/>
  <text x="600" y="200" text-anchor="middle" font-size="14" font-weight="500"
        font-family="Arial,Helvetica,sans-serif" fill="#5a6580" letter-spacing="3">YOU RECEIVED</text>
  <text x="600" y="340" text-anchor="middle" font-size="110" font-weight="700"
        font-family="Arial,Helvetica,sans-serif" fill="#e4e8f0" letter-spacing="-2">webcash</text>
  <text x="600" y="420" text-anchor="middle" font-size="18" font-weight="400"
        font-family="Arial,Helvetica,sans-serif" fill="#3a4a6a">Open link to redeem</text>
  <rect x="500" y="500" width="200" height="1" fill="#055DFF" opacity="0.3"/>
  <text x="600" y="550" text-anchor="middle" font-size="13" font-weight="400"
        font-family="Arial,Helvetica,sans-serif" fill="#2e3650">weby.cash</text>
</svg>`;

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
const png = resvg.render().asPng();
writeFileSync('static/og.png', png);
console.log(`og.png: ${(png.length / 1024).toFixed(0)} KB`);
