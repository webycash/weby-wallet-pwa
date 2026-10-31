/**
 * Dev-only funding helper: mine TEST webcash for the spec wallets through the
 * wallet's own in-browser miner (Webcash → Mining → Start; WebGPU `gpu_mine`)
 * against the dev rail https://dev.weby.cash/api/webcash ONLY.
 *
 * Guards: refuses to run unless runtime-config is `development` and points at
 * the dev rail; aborts every request to webcash.org (mainnet). Mines until each
 * wallet reaches E2E_MINE_TARGET (default 1 webcash; one dev solution pays
 * ~195), then clicks Stop and asserts the miner is idle.
 */
import { expect, test, type Browser } from '@playwright/test';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'https://dev.weby.cash/wallet').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/mine-dev';
const DEV_RAIL = 'https://dev.weby.cash/api/webcash';
const TARGET = Number(process.env.E2E_MINE_TARGET ?? '1');
const WHO = (process.env.E2E_MINE_WHO ?? 'A,B').split(',');
const MNEMONICS: Record<string, string> = process.env.E2E_MNEMONICS_FILE
	? (() => {
			const j = JSON.parse(fs.readFileSync(process.env.E2E_MNEMONICS_FILE!, 'utf8'));
			return { A: j.A, B: j.B };
		})()
	: {
	A: 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
	B: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'
};
// New-headless Chromium with WebGPU enabled (the wallet miner is WebGPU).
test.use({
	channel: process.env.E2E_CHANNEL ?? 'chromium',
	launchOptions: {
		args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--use-angle=metal']
	}
});
const log: unknown[] = [];
const note = (who: string, step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), who, step, data };
	log.push(e);
	console.log('MINE', JSON.stringify(e));
};

async function onboard(browser: Browser, who: string, mnemonic: string) {
	const context = await browser.newContext();
	// Never touch mainnet webcash.
	await context.route(/https?:\/\/([a-z0-9-]+\.)*webcash\.org\//, (r) => {
		note(who, 'blocked-mainnet', r.request().url());
		return r.abort();
	});
	const page = await context.newPage();
	page.on('pageerror', (e) => note(who, 'pageerror', e.message.slice(0, 300)));
	page.on('console', (m) => {
		if (/gpu|mine|mining|webgpu/i.test(m.text())) note(who, 'console', m.text().slice(0, 300));
	});
	await page.goto(`${BASE}/`);
	const rc = await page.evaluate(async (b) => (await fetch(`${b}/runtime-config.json`)).json(), BASE);
	if (rc.deployment !== 'development' || String(rc.webcash_server_url).replace(/\/$/, '') !== DEV_RAIL)
		throw new Error(`refusing to mine: deployment=${rc.deployment} rail=${rc.webcash_server_url}`);
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

async function webcashBalance(page: import('@playwright/test').Page): Promise<number> {
	await page.getByRole('button', { name: /^Webcash$/ }).first().click();
	await page.waitForTimeout(1500);
	const t = await page.locator('p.text-6xl').first().innerText({ timeout: 10_000 });
	return Number(t.replace(/[^0-9.]/g, '')) || 0;
}

for (const who of WHO) {
	test(`mine dev test webcash ${who}`, async ({ browser }) => {
		test.setTimeout(900_000);
		const result: Record<string, unknown> = { who, rail: DEV_RAIL, target: TARGET };
		const { context, page } = await onboard(browser, who, MNEMONICS[who]);
		try {
			result.before = await webcashBalance(page);
			note(who, 'balance-before', result.before);
			if ((result.before as number) < TARGET) {
				await page.getByRole('button', { name: /^Mining$/ }).first().click();
				const start = page.getByRole('button', { name: /^Start$/ });
				await start.waitFor({ timeout: 60_000 });
				result.backend = await page.locator('span.rounded-full').first().innerText().catch(() => null);
				await expect(start).toBeEnabled({ timeout: 60_000 });
				const t0 = Date.now();
				await start.click();
				note(who, 'mining-started', result.backend);
				// Stop as soon as one solution is accepted.
				const sol = page.locator('text=Solutions').locator('xpath=following-sibling::p').first();
				let lastNote = 0;
				const budget = Number(process.env.E2E_MINE_BUDGET_MS ?? '600000');
				while (Date.now() - t0 < budget) {
					const s = (await sol.innerText().catch(() => '0/0')).split('/')[0];
					if (Number(s) >= 1) break;
					if (Date.now() - lastNote > 10_000) {
						lastNote = Date.now();
						const body = await page.locator('main').innerText().catch(() => '');
						const m = body.match(/Speed[\s\S]{0,400}?Uptime\s*\S+\s*\S+/);
						const errBox = body.match(/(GPU mining failed|Error|failed)[^\n]{0,200}/i);
						note(who, 'miner-stats', { stats: m ? m[0].replace(/\s+/g, ' ') : null, err: errBox ? errBox[0] : null });
					}
					await page.waitForTimeout(1000);
				}
				await page.getByRole('button', { name: /^Stop$/ }).click({ timeout: 10_000 }).catch(() => {});
				await page.getByRole('button', { name: /^Start$/ }).waitFor({ timeout: 120_000 });
				result.miningMs = Date.now() - t0;
				result.minerIdle = !(await page.evaluate(() => {
					// MinerPanel sets the miner flag; Start visible again == loop exited.
					return !!document.querySelector('button')?.textContent?.includes('Stop');
				}));
				fs.mkdirSync(OUT, { recursive: true });
				await page.screenshot({ path: `${OUT}/${who}-mined.png`, fullPage: true });
			}
			result.after = await webcashBalance(page);
			note(who, 'balance-after', result.after);
		} finally {
			fs.mkdirSync(OUT, { recursive: true });
			fs.writeFileSync(`${OUT}/mine-${who}.json`, JSON.stringify({ result, log }, null, 1));
			await context.close();
		}
		expect(result.after as number).toBeGreaterThanOrEqual(TARGET);
	});
}
