/**
 * Step 7 live smoke: the deployment serves the profile's exact network config
 * (Ark enabled on the profile's ASP) and the exchange shell loads.
 * Profile: E2E_GATE_PROFILE=dev (default) | staging-mainnet (needs E2E_BASE_URL).
 * Vitest covers attemptRunSwapBoundary reachedRunSwap + named gate.
 * Does NOT claim settled.
 */
import { test, expect } from '@playwright/test';
import { profileMismatches, selectGateProfile } from './helpers/gate-profile';

const { profile, baseUrl: BASE } = selectGateProfile();

test(`${profile.name} runtime ark_enabled + wallet shell 200`, async ({ page }) => {
	const cfg = await page.request.get(`${BASE}/runtime-config.json`);
	expect(cfg.ok()).toBeTruthy();
	const json = await cfg.json();
	expect(profileMismatches(profile, json)).toEqual([]);
	expect(json.ark_enabled).toBe(true);
	const res = await page.goto(`${BASE}/`);
	expect(res?.ok()).toBeTruthy();
	await expect(page).toHaveTitle(/Weby Wallet/i);
});
