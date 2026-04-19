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
    <radialGradient id="glow" cx="50%" cy="50%" r="40%">
      <stop offset="0%" stop-color="#055DFF" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#055DFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <circle cx="56" cy="46" r="16" stroke="#055DFF" stroke-width="1.5" fill="none" opacity="0.4"/>
  <text x="56" y="52" text-anchor="middle" font-size="14" font-weight="700"
        font-family="Arial,Helvetica,sans-serif" fill="#055DFF" opacity="0.4">W</text>
  <text x="600" y="350" text-anchor="middle" font-size="110" font-weight="700"
        font-family="Arial,Helvetica,sans-serif" fill="#e4e8f0" letter-spacing="-2">webcash</text>
  <text x="1150" y="600" text-anchor="end" font-size="12" font-weight="500"
        font-family="Arial,Helvetica,sans-serif" fill="#3a4a6a" letter-spacing="2">REDEEM</text>
</svg>`;

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
const png = resvg.render().asPng();
writeFileSync('static/og.png', png);
console.log(`og.png: ${(png.length / 1024).toFixed(0)} KB`);
