/**
 * Generate OG image (1200x630 PNG, optimized).
 * Run: node scripts/gen-og.mjs
 */
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';

const W = 1200, H = 630;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="#0f1118"/>
      <stop offset="100%" stop-color="#0b0d14"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="40%">
      <stop offset="0%" stop-color="#055DFF" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#055DFF" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- W mark -->
  <circle cx="600" cy="220" r="48" stroke="#055DFF" stroke-width="2" fill="none" opacity="0.8"/>
  <text x="600" y="241" text-anchor="middle" font-size="38" font-weight="700"
        font-family="Arial,Helvetica,sans-serif" fill="#055DFF">W</text>

  <!-- Title -->
  <text x="600" y="330" text-anchor="middle" font-size="40" font-weight="600"
        font-family="Arial,Helvetica,sans-serif" fill="#e4e8f0" letter-spacing="-0.5">
    You received webcash
  </text>

  <!-- Subtitle -->
  <text x="600" y="375" text-anchor="middle" font-size="20" font-weight="400"
        font-family="Arial,Helvetica,sans-serif" fill="#5a6580">
    Open to redeem
  </text>

  <!-- Domain -->
  <text x="600" y="570" text-anchor="middle" font-size="15" font-weight="500"
        font-family="Arial,Helvetica,sans-serif" fill="#2e3650" letter-spacing="0.5">
    weby.cash
  </text>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: W },
});
const png = resvg.render().asPng();

writeFileSync('static/og.png', png);
console.log(`og.png: ${(png.length / 1024).toFixed(0)} KB`);
