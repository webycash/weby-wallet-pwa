/**
 * Markets publish → discover, two browsers, NO funds and NO settle.
 *
 * Two fresh, never-funded wallets (random mnemonics generated in-process, never
 * logged or written). A: Exchange → Markets → pair → Publish a limit order.
 * B: same pair → refresh until the exact order (unique price) appears in its
 * DHTX book. The test never clicks Place/Accept, so no swap and no payment can
 * start. If the live book already holds third-party makers, the publish path
 * asks for a seeder fee; with an empty wallet that fails closed and the test
 * reports it (nothing is paid).
 *
 * Usage: E2E_BASE_URL=https://weby.cash/wallet E2E_EVIDENCE_DIR=... npx playwright test e2e/exchange-publish-discover.spec.ts
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'https://dev.weby.cash/wallet').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/publish-discover';
const PAIR = /Webcash.*(Ark|ARK)|(Ark|ARK).*Webcash/;
// Unique per run so B can only match THIS order.
const PRICE = String(10_000 + Math.floor(Math.random() * 89_999));
const AMOUNT = process.env.E2E_ORDER_AMOUNT ?? '1';
const SECRETISH = /mnemonic|seed|secret|private|xprv|passphrase/i;
const log: Record<string, unknown>[] = [];
const note = (who: string, step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), who, step, data };
	log.push(e);
	console.log('PDEV', JSON.stringify(e));
};
const shot = async (page: Page, who: string, step: string) => {
	fs.mkdirSync(OUT, { recursive: true });
	await page.screenshot({ path: `${OUT}/${who}-${step}.png`, fullPage: true });
};

async function onboard(browser: Browser, who: string) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on('console', (m) => {
		const t = m.text();
		if (!SECRETISH.test(t) && (m.type() === 'error' || /order|peer|dhtx/i.test(t)))
			note(who, 'console', `${m.type()}: ${t.slice(0, 300)}`);
	});
	page.on('pageerror', (e) => note(who, 'pageerror', e.message.slice(0, 300)));
	await page.goto(`${BASE}/`);
	const tos = page.getByText('I accept the terms');
	await tos.waitFor({ timeout: 60_000 });
	const box = page.getByRole('checkbox').first();
	if (await box.isVisible().catch(() => false)) await box.check().catch(() => tos.click());
	else await tos.click();
	await page.getByRole('button', { name: /^Continue$/ }).click();
	await page.getByRole('button', { name: /Recover/ }).first().click();
	await page.getByPlaceholder('24 words or 64-char hex...').fill(generateMnemonic(wordlist, 256));
	await page.getByRole('button', { name: /^Recover$/ }).click();
	const skip = page.getByRole('button', { name: /Skip Encryption/ });
	await skip.waitFor({ timeout: 90_000 }).catch(() => {});
	if (await skip.isVisible()) {
		await page.getByText('No encryption').click();
		await skip.click();
	}
	await page.getByRole('button', { name: /^Exchange$/ }).first().waitFor({ timeout: 60_000 });
	note(who, 'onboarded');
	return { context, page };
}

const connection = (page: Page) =>
	page.evaluate(() => {
		const raw = localStorage.getItem('extro_connection_status_v1');
		return raw ? JSON.parse(raw) : null;
	});

async function waitPeers(page: Page, who: string, timeoutMs = 240_000) {
	const t0 = Date.now();
	let st: { peers_connected?: number } | null = null;
	while (Date.now() - t0 < timeoutMs) {
		st = await connection(page);
		if (st && Number(st.peers_connected) > 0) break;
		await page.waitForTimeout(3000);
	}
	note(who, 'connection', { ...st, ms: Date.now() - t0 });
	return st;
}

async function openTrade(page: Page, who: string) {
	await page.getByRole('button', { name: /^Exchange$/ }).first().click();
	await page.getByRole('button', { name: /Markets/ }).first().click().catch(() => {});
	await page.getByTestId('market-available').first().waitFor({ timeout: 30_000 });
	await page.getByTestId('market-available').filter({ hasText: PAIR }).first().click();
	await shot(page, who, 'trade');
}

const bookRow = (page: Page) =>
	page
		.locator('div.grid.grid-cols-3')
		.filter({ hasText: Number(PRICE).toLocaleString('en-US') })
		.filter({ hasText: /dhtx|peer/i });

test('markets publish → discover across two browsers (no funds, no settle)', async ({ browser }) => {
	test.setTimeout(Number(process.env.E2E_TEST_TIMEOUT_MS ?? '600000'));
	const result: Record<string, unknown> = { base: BASE, order: { side: 'Sell', amount: AMOUNT, price: PRICE } };
	const a = await onboard(browser, 'A');
	const b = await onboard(browser, 'B');
	try {
		result.connection = { A: await waitPeers(a.page, 'A'), B: await waitPeers(b.page, 'B', 60_000) };
		await openTrade(a.page, 'A');
		await openTrade(b.page, 'B');
		await a.page.getByRole('button', { name: /^Sell$/ }).click();
		await a.page.getByPlaceholder('0.00').nth(0).fill(AMOUNT);
		await a.page.getByPlaceholder('0.00').nth(1).fill(PRICE);
		await a.page.getByRole('button', { name: /Publish order/ }).click();
		const ban = a.page.getByTestId('exchange-banner');
		await ban.waitFor({ timeout: 60_000 }).catch(() => {});
		result.publishBanner = (await ban.isVisible()) ? await ban.innerText() : null;
		result.published = /Order published to/.test(String(result.publishBanner));
		await shot(a.page, 'A', 'published');
		result.makerSeesOwn = (await bookRow(a.page).count()) > 0;
		let seen = false;
		const t0 = Date.now();
		for (let i = 0; i < 40 && !seen && result.published; i++) {
			await b.page.getByRole('button', { name: /Refresh|refresh/ }).first().click().catch(() => {});
			await b.page.waitForTimeout(3000);
			seen = (await bookRow(b.page).count()) > 0;
		}
		result.discovered = seen;
		result.discoverMs = Date.now() - t0;
		result.discoveredRow = seen ? await bookRow(b.page).first().innerText() : null;
		await shot(b.page, 'B', 'discover');
	} finally {
		result.status = result.published && result.discovered ? 'PASS' : 'FAIL';
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(`${OUT}/publish-discover.json`, JSON.stringify({ result, log }, null, 1));
		await a.context.close();
		await b.context.close();
	}
	expect(result.published && result.discovered, JSON.stringify(result)).toBe(true);
});
