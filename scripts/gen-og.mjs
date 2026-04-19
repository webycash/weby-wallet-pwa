import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#ffffff"/>
  <circle cx="72" cy="68" r="24" stroke="#003DA5" stroke-width="2.5" fill="none"/>
  <text x="72" y="77" text-anchor="middle" font-size="22" font-weight="700"
        font-family="Arial,sans-serif" fill="#003DA5">W</text>
  <text x="600" y="340" text-anchor="middle" font-size="120" font-weight="700"
        font-family="Arial,sans-serif" fill="#0a1a3a" letter-spacing="-2">&#x20A9; webcash</text>
  <text x="1152" y="594" text-anchor="end" font-size="14" font-weight="500"
        font-family="Arial,sans-serif" fill="#8898b8" letter-spacing="2">REDEEM</text>
</svg>`;

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
writeFileSync('static/og.png', resvg.render().asPng());
console.log(`og.png: ${(resvg.render().asPng().length / 1024).toFixed(0)} KB`);
