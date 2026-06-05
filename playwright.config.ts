// Playwright config for the TWO-REAL-BROWSER-NODE end-to-end exchange harness.
//
// This config exists ONLY for the e2e/ harness (the real publish→discover→match
// →settle proof over real wasm extro-node + WebRTC + DHTX). The pure-logic suite
// stays on vitest (`npm test`, src/**/*.test.ts) and is untouched.
//
// HARD CONSTRAINTS baked in here (see e2e/README.md):
//
//  * The dev server is started with `vite dev` DIRECTLY — NOT `npm run dev` —
//    because `predev` runs scripts/sync-wasm.mjs (the forbidden wasm/cargo
//    toolchain step). The wasm artifact in src/lib/node/pkg/ must already be
//    synced by the operator BEFORE running this harness; the harness never
//    builds or syncs it.
//
//  * A NON-default port (5183) is used so a live dev session on 5174 is never
//    disturbed. Override with E2E_PORT / E2E_BASE_URL if 5183 is taken.
//
//  * `import.meta.env.DEV` must be true for the page to expose `window.__extro`
//    (the real bundled client the no-mock guard inspects). `vite dev` satisfies
//    DEV; `vite preview` / a static build do NOT — so we never point at those.
//
//  * The app's adapter is forced to the REAL bundled wasm node via
//    PUBLIC_EXTRO_ADAPTER=bundled in the webServer env. The no-mock guard
//    fails loudly if a mock adapter is ever observed in the path.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5183);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
	testDir: 'e2e',
	// One real chain at a time: two browser-node contexts inside a single spec,
	// real WebRTC + real rail. Parallelism across files would contend for the
	// referee/rail stack — keep it serial and honest.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: [['list']],
	timeout: 120_000,
	expect: { timeout: 30_000 },
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		// Real WebRTC needs a real browser; chromium is the reference target.
		...devices['Desktop Chrome'],
		launchOptions: {
			// Allow loopback WebRTC + fake media gates so two contexts on one host
			// can complete a DataChannel handshake without operator interaction.
			args: [
				'--use-fake-ui-for-media-stream',
				'--use-fake-device-for-media-stream'
			]
		}
	},
	// Start the REAL app (vite dev, NOT npm run dev — see note above). If the
	// operator already has a server on BASE_URL, reuse it.
	webServer: {
		command: `npx vite dev --port ${PORT} --strictPort`,
		url: BASE_URL,
		reuseExistingServer: true,
		timeout: 120_000,
		env: {
			// Force the real same-realm wasm node; the guard rejects any mock.
			PUBLIC_EXTRO_ADAPTER: 'bundled'
		}
	}
});
