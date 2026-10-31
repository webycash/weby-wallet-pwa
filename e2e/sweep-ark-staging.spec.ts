/**
 * Staging/mainnet recovery: sweep a burned wallet's Ark VTXOs (off-chain Ark
 * send via the product UI) into a FRESH wallet. Phrases come from SENSITIVE
 * files (never logged): E2E_FROM_FILE/E2E_FROM_KEY and E2E_TO_FILE/E2E_TO_KEY.
 * Refuses unless deployment=staging on webcash.org, and caps the amount.
 */
import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'https://weby-wallet-pwa-staging.harmoniis.workers.dev/wallet').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/sweep-ark-staging';
const CAP = Number(process.env.E2E_MAX_SWEEP_SAT ?? '3000');
const phrase = (file?: string, key?: string) => {
	if (!file || !key) throw new Error('E2E_FROM_FILE/KEY and E2E_TO_FILE/KEY required');
	const v = JSON.parse(fs.readFileSync(file, 'utf8'))[key];
	if (typeof v !== 'string' || v.split(/\s+/).length < 12) throw new Error(`no phrase for ${key}`);
	return v;
};
const FROM = phrase(process.env.E2E_FROM_FILE, process.env.E2E_FROM_KEY);
const TO = phrase(process.env.E2E_TO_FILE, process.env.E2E_TO_KEY);
const log: unknown[] = [];
const note = (who: string, step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), who, step, data };
	log.push(e);
	console.log('SWEEP', JSON.stringify(e));
};

async function onboard(browser: Browser, who: string, mnemonic: string) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on('pageerror', (e) => note(who, 'pageerror', e.message.slice(0, 300)));
	await page.goto(`${BASE}/`);
	const rc = await page.evaluate(async (b) => (await fetch(`${b}/runtime-config.json`)).json(), BASE);
	if (rc.deployment !== 'staging' || String(rc.webcash_server_url).replace(/\/$/, '') !== 'https://webcash.org')
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

async function arkView(page: Page) {
	await page.getByRole('button', { name: /^Bitcoin$/ }).first().click();
	await page.getByRole('button', { name: /^ARK$/ }).first().click();
	await page.getByTestId('ark-balance').waitFor({ timeout: 90_000 });
	await page.waitForTimeout(1500);
	return {
		address: (await page.getByTestId('ark-address').innerText()).trim(),
		balance: Number((await page.getByTestId('ark-balance').innerText()).replace(/[^\d]/g, '')) || 0,
		vtxos: (await page.getByTestId('ark-vtxos').innerText()).split('\n').slice(1)
	};
}

test('sweep burned wallet Ark balance into fresh wallet', async ({ browser }) => {
	fs.mkdirSync(OUT, { recursive: true });
	const result: Record<string, unknown> = { base: BASE, cap: CAP };
	try {
		const to = await onboard(browser, 'TO', TO);
		const toBefore = await arkView(to.page);
		result.toBefore = toBefore;
		note('TO', 'before', toBefore);
		await to.page.screenshot({ path: `${OUT}/to-before.png`, fullPage: true });

		const from = await onboard(browser, 'FROM', FROM);
		const fromBefore = await arkView(from.page);
		result.fromBefore = fromBefore;
		note('FROM', 'before', fromBefore);
		await from.page.screenshot({ path: `${OUT}/from-before.png`, fullPage: true });
		if (fromBefore.balance <= 0) throw new Error('nothing to sweep');
		if (fromBefore.balance > CAP) throw new Error(`refusing: ${fromBefore.balance} sat > cap ${CAP}`);
		if (!toBefore.address.startsWith('ark1')) throw new Error(`refusing: destination is not a mainnet ark address`);

		await from.page.getByTestId('ark-send-address').fill(toBefore.address);
		await from.page.getByTestId('ark-send-amount').fill(String(fromBefore.balance));
		await from.page.getByTestId('ark-send-submit').click();
		const msg = from.page.getByTestId('ark-send-message');
		await msg.waitFor({ timeout: 180_000 });
		await from.page.waitForFunction(() => {
			const t = document.querySelector('[data-testid="ark-send-message"]')?.textContent ?? '';
			return /Sent|failed/i.test(t);
		}, null, { timeout: 180_000 });
		result.sendMessage = (await msg.innerText()).trim();
		note('FROM', 'send', result.sendMessage);
		result.arkTxid = /Ark tx ([0-9a-f]{64})/i.exec(String(result.sendMessage))?.[1] ?? null;
		await from.page.screenshot({ path: `${OUT}/from-after-send.png`, fullPage: true });

		for (let i = 0; i < 12; i++) {
			await to.page.reload();
			await to.page.getByRole('button', { name: /^Exchange$/ }).first().waitFor({ timeout: 90_000 });
			const v = await arkView(to.page);
			result.toAfter = v;
			if (v.balance > toBefore.balance) break;
			await to.page.waitForTimeout(5000);
		}
		note('TO', 'after', result.toAfter);
		await to.page.screenshot({ path: `${OUT}/to-after.png`, fullPage: true });
		await from.page.reload();
		await from.page.getByRole('button', { name: /^Exchange$/ }).first().waitFor({ timeout: 90_000 });
		result.fromAfter = await arkView(from.page);
		note('FROM', 'after', result.fromAfter);
	} finally {
		fs.writeFileSync(`${OUT}/sweep.json`, JSON.stringify({ result, log }, null, 1));
	}
});
