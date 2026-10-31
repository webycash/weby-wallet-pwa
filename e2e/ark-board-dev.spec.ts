/**
 * Dev-only (signet): board the spec wallets' confirmed boarding outputs into
 * Ark VTXOs through the real UI (Bitcoin → ARK → Board via ASP). Signatures
 * come from the extro-node WASM. Writes non-secret evidence only.
 */
import { expect, test, type Browser } from '@playwright/test';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'https://dev.weby.cash/wallet').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/ark-board-dev';
const DEV_RAIL = 'https://dev.weby.cash/api/webcash';
const WHO = (process.env.E2E_REG_WHO ?? 'A,B').split(',');
const NICK: Record<string, string> = { A: process.env.E2E_NICK_A ?? 'specwallet-a', B: process.env.E2E_NICK_B ?? 'specwallet-b' };
// Public BIP39 test vectors (same as e2e/mine-dev-webcash.spec.ts).
const MNEMONICS: Record<string, string> = {
	A: 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
	B: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'
};
const log: unknown[] = [];
const note = (who: string, step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), who, step, data };
	log.push(e);
	console.log('BOARD', JSON.stringify(e));
};

async function onboard(browser: Browser, who: string, mnemonic: string) {
	const context = await browser.newContext();
	await context.route(/https?:\/\/([a-z0-9-]+\.)*webcash\.org\//, (r) => {
		note(who, 'blocked-mainnet', r.request().url());
		return r.abort();
	});
	const page = await context.newPage();
	page.on('pageerror', (e) => note(who, 'pageerror', e.message.slice(0, 300)));
	page.on('console', (m) => {
		const t = m.text();
		if (/ark|board|settle|asp/i.test(t) && !/secret/i.test(t)) note(who, 'console', t.slice(0, 300));
	});
	await page.goto(`${BASE}/`);
	const rc = await page.evaluate(async (b) => (await fetch(`${b}/runtime-config.json`)).json(), BASE);
	if (rc.deployment !== 'development' || String(rc.webcash_server_url).replace(/\/$/, '') !== DEV_RAIL)
		throw new Error(`refusing: deployment=${rc.deployment} rail=${rc.webcash_server_url}`);
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
	return { context, page };
}


for (const who of WHO) {
	test(`board ark ${who}`, async ({ browser }) => {
		const result: Record<string, unknown> = { who };
		const { context, page } = await onboard(browser, who, MNEMONICS[who]);
		try {
			await page.getByRole('button', { name: /^Bitcoin$/ }).first().click();
			await page.getByRole('button', { name: /^ARK$/ }).first().click();
			await page.getByTestId('ark-balance').waitFor({ timeout: 60_000 });
			result.before = await page.getByTestId('ark-view').innerText();
			note(who, 'before', result.before);
			const btn = page.getByTestId('ark-board');
			if (!(await btn.isVisible().catch(() => false))) {
				result.noBoardButton = true;
			} else {
				const t0 = Date.now();
				await btn.click();
				await expect(page.getByTestId('ark-board-message')).toHaveText(/Boarded|Boarding failed/, { timeout: 600_000 });
				result.boardMs = Date.now() - t0;
				result.message = await page.getByTestId('ark-board-message').innerText();
				note(who, 'board-result', result.message);
			}
			await page.waitForTimeout(3000);
			result.after = await page.getByTestId('ark-view').innerText();
			fs.mkdirSync(OUT, { recursive: true });
			await page.screenshot({ path: `${OUT}/${who}-boarded.png`, fullPage: true });
		} finally {
			fs.mkdirSync(OUT, { recursive: true });
			fs.writeFileSync(`${OUT}/board-${who}.json`, JSON.stringify({ result, log }, null, 1));
			await context.close();
		}
		expect(String(result.message ?? '')).toMatch(/Boarded/);
	});
}
