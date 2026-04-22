import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';
import { LOGO_CIRCLE, LOGO_TEXT } from '../worker/src/logo.js';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#faf9fc"/>
  <g transform="translate(60,228) scale(0.20)">
    ${LOGO_CIRCLE}
    ${LOGO_TEXT}
  </g>
  <text x="660" y="345" text-anchor="middle" font-size="100" font-weight="700"
        font-family="Geist,Inter,sans-serif" fill="#7B4DB8" letter-spacing="-2">weby.cash</text>
</svg>`;

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
writeFileSync('static/og.png', resvg.render().asPng());
console.log(`og.png: ${(resvg.render().asPng().length / 1024).toFixed(0)} KB`);
