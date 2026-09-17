/**
 * Step 7 live smoke: dev keeps Ark gated; exchange shell loads.
 * Vitest covers attemptRunSwapBoundary reachedRunSwap + named gate.
 * Does NOT claim settled.
 */
import { test, expect } from '@playwright/test';

const BASE = (process.env.E2E_BASE_URL ?? 'https://dev.weby.cash/wallet').replace(/\/$/, '');

test('dev runtime ark_enabled + wallet shell 200', async ({ page }) => {
	const cfg = await page.request.get(`${BASE}/runtime-config.json`);
	expect(cfg.ok()).toBeTruthy();
	const json = await cfg.json();
	expect(json.ark_enabled).toBe(true);
	expect(json.ark_asp_url).toBe('https://signet.arkade.sh');
	expect(String(json.webcash_server_url)).toContain('dev.weby.cash');
	expect(json.deployment).toBe('development');
	const res = await page.goto(`${BASE}/`);
	expect(res?.ok()).toBeTruthy();
	await expect(page).toHaveTitle(/Weby Wallet/i);
});
