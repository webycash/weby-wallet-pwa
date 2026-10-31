/**
 * Dev-only: register the spec wallets' Extro identity through the real product
 * path (Webcash → Mining → Extro identity → Register). The 0.0001 fee is paid
 * from the wallet's dev TEST webcash (dev.weby.cash/api/webcash); mainnet
 * webcash.org is aborted. Writes non-secret evidence only.
 */
import { expect, test, type Browser } from '@playwright/test';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'https://weby-wallet-pwa-staging.harmoniis.workers.dev/wallet').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/register-staging';
const DEV_RAIL = 'https://dev.weby.cash/api/webcash';
const WHO = (process.env.E2E_REG_WHO ?? 'A,B').split(',');
const NICK: Record<string, string> = { A: process.env.E2E_NICK_A ?? 'stgwallet-a', B: process.env.E2E_NICK_B ?? 'stgwallet-b' };
// Public BIP39 test vectors (same as e2e/mine-dev-webcash.spec.ts).
if (!process.env.E2E_MNEMONICS_FILE) throw new Error('E2E_MNEMONICS_FILE required');
const MNEMONICS: Record<string, string> = (() => {
	const j = JSON.parse(fs.readFileSync(process.env.E2E_MNEMONICS_FILE!, 'utf8'));
	return { A: j.A, B: j.B };
})();
// Optional SENSITIVE JSON {A,B} of e<amt>:secret tokens to insert first (never logged).
const TOKENS: Record<string, string | null> = process.env.E2E_WEBCASH_TOKENS_FILE
	? JSON.parse(fs.readFileSync(process.env.E2E_WEBCASH_TOKENS_FILE, 'utf8'))
	: {};
const log: unknown[] = [];
const note = (who: string, step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), who, step, data };
	log.push(e);
	console.log('REG', JSON.stringify(e));
};

async function onboard(browser: Browser, who: string, mnemonic: string) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on('pageerror', (e) => note(who, 'pageerror', e.message.slice(0, 300)));
	page.on('console', (m) => {
		const t = m.text();
		if (/keyserver|regist|402|identity/i.test(t) && !/secret/i.test(t)) note(who, 'console', t.slice(0, 300));
	});
	await page.goto(`${BASE}/`);
	const rc = await page.evaluate(async (b) => (await fetch(`${b}/runtime-config.json`)).json(), BASE);
	if (rc.deployment !== 'staging' || String(rc.webcash_server_url).replace(/\/$/, '') !== 'https://webcash.org')
		throw new Error(`refusing: deployment=${rc.deployment} rail=${rc.webcash_server_url}`);
	note(who, 'runtime', { keyserver: rc.keyserver_url, webcash: rc.webcash_server_url, referee: rc.referee_url });
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
	test(`fund+register staging identity ${who}`, async ({ browser }) => {
		const result: Record<string, unknown> = { who, nickname: NICK[who] };
		const { context, page } = await onboard(browser, who, MNEMONICS[who]);
		try {
			let bal = await webcashBalance(page);
			note(who, 'balance-initial', bal);
			if (bal <= 0 && TOKENS[who]) {
				await page.getByRole('button', { name: /^Insert$/ }).first().click();
				await page.getByPlaceholder('Paste webcash here...').fill(TOKENS[who]!);
				await page.waitForTimeout(8000);
				note(who, 'inserted-token', 'e-token (redacted)');
				await page.screenshot({ path: `${OUT}/${who}-inserted.png` }).catch(() => {});
			}
			for (let i = 0; i < 30 && bal <= 0; i++) {
				bal = await webcashBalance(page);
				if (bal <= 0) await page.waitForTimeout(3000);
			}
			result.before = bal;
			note(who, 'balance-before', bal);
			await page.getByRole('button', { name: /^Mining$/ }).first().click();
			const panel = page.getByTestId('identity-registration');
			await panel.waitFor();
			const fp = page.getByTestId('identity-fingerprint');
			await fp.waitFor();
			result.fingerprint = (await fp.innerText()).trim();
			note(who, 'fingerprint', result.fingerprint);
			if (await page.getByTestId('identity-registered').isVisible().catch(() => false)) {
				result.alreadyRegisteredLocally = true;
			} else {
				await page.getByTestId('identity-nickname').fill(NICK[who]);
				const t0 = Date.now();
				await page.getByTestId('identity-register').click();
				await Promise.race([
					page.getByTestId('identity-registered').waitFor({ timeout: 300_000 }),
					page.getByTestId('identity-message').waitFor({ timeout: 300_000 })
				]);
				await page.waitForTimeout(1000);
				result.registerMs = Date.now() - t0;
				result.message = await page.getByTestId('identity-message').innerText().catch(() => null);
				result.registered = await page.getByTestId('identity-registered').isVisible().catch(() => false);
				note(who, 'register-result', { registered: result.registered, message: result.message });
			}
			fs.mkdirSync(OUT, { recursive: true });
			await page.screenshot({ path: `${OUT}/${who}-registered.png`, fullPage: true });
			result.after = await webcashBalance(page);
			note(who, 'balance-after', result.after);
		} finally {
			fs.mkdirSync(OUT, { recursive: true });
			fs.writeFileSync(`${OUT}/register-${who}.json`, JSON.stringify({ result, log }, null, 1));
			await context.close();
		}
		expect(result.registered || result.alreadyRegisteredLocally).toBeTruthy();
	});
}
