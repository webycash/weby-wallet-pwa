/** x17 read-only: webcash wallet check (health_check only, no replace) for A/B on local vite w/ staging config. */
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:5183').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/coop-evict';
const WAIT_MS = Number(process.env.E2E_EVICT_WAIT_MS ?? 200_000);
const MN = JSON.parse(fs.readFileSync(process.env.E2E_MNEMONICS_FILE!, 'utf8'));
const log: unknown[] = [];
const note = (step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), step, data };
	log.push(e);
	console.log('COOP', JSON.stringify(e));
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(`${OUT}/coop-evict.json`, JSON.stringify(log, null, 1));
};

async function onboard(browser: Browser, mnemonic: string): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`${BASE}/`);
	const rc = await page.evaluate(async (b) => (await fetch(`${b}/runtime-config.json`)).json(), BASE);
	const okDev = rc.deployment === 'development' && rc.ark_network === 'signet';
	const okStagingDry = process.env.E2E_ALLOW_STAGING_DRY === '1' && rc.deployment === 'staging' && rc.ark_network === 'bitcoin';
	if (!okDev && !okStagingDry) throw new Error('refusing: not dev/signet (or explicit staging dry)');
	const tos = page.getByText('I accept the terms');
	await tos.waitFor({ timeout: 60_000 });
	const box = page.getByRole('checkbox').first();
	if (await box.isVisible().catch(() => false)) await box.check().catch(() => tos.click());
	else await tos.click();
	await page.getByRole('button', { name: /^Continue$/ }).click();
	await page.getByRole('button', { name: /Recover/ }).first().click();
	await page.getByPlaceholder('24 words or 64-char hex...').fill(mnemonic);
	await page.getByRole('button', { name: /^Recover$/ }).click();
	const skip = page.getByRole('button', { name: /Skip Encryption/ });
	await skip.waitFor({ timeout: 90_000 }).catch(() => {});
	if (await skip.isVisible()) {
		await page.getByText('No encryption').click();
		await skip.click();
	}
	await page.getByRole('button', { name: /^Exchange$/ }).first().waitFor({ timeout: 60_000 });
	return page;
}

test('webcash check A/B (read-only)', async ({ browser }) => {
	test.setTimeout(300_000);
	const out: Record<string, unknown> = {};
	for (const who of ['A', 'B'] as const) {
		const p = await onboard(browser, (MN as any)[who]);
		await p.waitForTimeout(8000);
		out[who] = await p.evaluate(async () => {
			const w = await import('/src/lib/stores/wallet.svelte.ts');
			const before = await (w as any).getBalance?.().catch?.(() => null);
			const chk = await w.checkWallet();
			const after = await (w as any).getBalance?.().catch?.(() => null);
			return { before, chk, after, keys: Object.keys(w).filter((k) => /alance|utput/.test(k)) };
		});
		console.log('WCCHK', who, JSON.stringify(out[who]));
		await p.context().close();
	}
	fs.mkdirSync(process.env.E2E_EVIDENCE_DIR!, { recursive: true });
	fs.writeFileSync(`${process.env.E2E_EVIDENCE_DIR}/check.json`, JSON.stringify(out, null, 1));
	expect(out.A).toBeTruthy();
});
