/**
 * Exchange prod gate — UI-ONLY two-browser run on live CF dev (no __extro calls).
 * A: Markets → pair → Trade → Publish order. B: Markets → pair → Trade → sees order → Place limit (Accept→runSwap).
 * Records every banner / named gate as evidence. Never asserts a fake "settled".
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'https://dev.weby.cash/wallet').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/exchange-ui';
const MNEMONICS = [
	'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
	'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'
];
const log: Record<string, unknown>[] = [];
const note = (who: string, step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), who, step, data };
	log.push(e);
	console.log('UIEV', JSON.stringify(e));
};

async function shot(page: Page, who: string, step: string) {
	fs.mkdirSync(OUT, { recursive: true });
	await page.screenshot({ path: `${OUT}/${who}-${step}.png`, fullPage: true });
}

async function onboard(browser: Browser, who: string, mnemonic: string) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on('console', (m) => {
		if (m.type() === 'error' || /gate|swap|order|seeder|peer/i.test(m.text()))
			note(who, 'console', `${m.type()}: ${m.text().slice(0, 400)}`);
	});
	page.on('pageerror', (e) => note(who, 'pageerror', e.message.slice(0, 400)));
	await page.goto(`${BASE}/`);
	await page.getByText('I accept the terms').click();
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
	await shot(page, who, '01-onboarded');
	note(who, 'onboarded');
	return { context, page };
}

async function openTrade(page: Page, who: string, pairText: RegExp) {
	await page.getByRole('button', { name: /^Exchange$/ }).first().click();
	await page.getByRole('button', { name: /Markets/ }).first().click().catch(() => {});
	await page.getByTestId('market-available').first().waitFor({ timeout: 30_000 });
	const markets = await page.getByTestId('market-available').allInnerTexts();
	note(who, 'markets', markets);
	await page.getByTestId('market-available').filter({ hasText: pairText }).first().click();
	await shot(page, who, '02-trade');
}

async function banner(page: Page, who: string, step: string, timeout = 60_000) {
	const b = page.getByTestId('exchange-banner');
	await b.waitFor({ timeout }).catch(() => {});
	const text = (await b.isVisible()) ? await b.innerText() : null;
	const gate = (await page.getByTestId('named-ark-gate').isVisible())
		? await page.getByTestId('named-ark-gate').innerText()
		: null;
	note(who, step, { banner: text, gate });
	await shot(page, who, step);
	return { text, gate };
}

for (const dir of [
	{ name: 'webcash-to-ark', pair: /Webcash.*(Ark|ARK)|(Ark|ARK).*Webcash/, makerSide: 'Sell' },
	{ name: 'ark-to-webcash', pair: /Webcash.*(Ark|ARK)|(Ark|ARK).*Webcash/, makerSide: 'Buy' }
] as const) {
	test(`exchange UI two-browser ${dir.name}`, async ({ browser }) => {
		test.setTimeout(600_000);
		const result: Record<string, unknown> = { direction: dir.name, base: BASE };
		const a = await onboard(browser, `A-${dir.name}`, MNEMONICS[0]);
		const b = await onboard(browser, `B-${dir.name}`, MNEMONICS[1]);
		try {
			await openTrade(a.page, `A-${dir.name}`, dir.pair);
			await openTrade(b.page, `B-${dir.name}`, dir.pair);
			// Maker A publishes.
			await a.page.getByRole('button', { name: new RegExp(`^${dir.makerSide}$`) }).click();
			await a.page.getByPlaceholder('0.00').nth(0).fill('1');
			await a.page.getByPlaceholder('0.00').nth(1).fill('1000');
			await a.page.getByRole('button', { name: /Publish order/ }).click();
			result.publish = await banner(a.page, `A-${dir.name}`, '03-publish');
			const published = /Order published to/.test(String((result.publish as any).text));
			result.published = published;
			if (published) {
				// Taker B discovers + accepts via Place limit on the opposite side.
				let seen = false;
				for (let i = 0; i < 30 && !seen; i++) {
					await b.page.getByRole('button', { name: /Refresh|refresh/ }).first().click().catch(() => {});
					await b.page.waitForTimeout(2000);
					seen = /1,000|1000/.test(await b.page.locator('body').innerText());
				}
				result.discovered = seen;
				await shot(b.page, `B-${dir.name}`, '04-discover');
				const takerSide = dir.makerSide === 'Sell' ? 'Buy' : 'Sell';
				await b.page.getByRole('button', { name: new RegExp(`^${takerSide}$`) }).click();
				await b.page.getByPlaceholder('0.00').nth(0).fill('1');
				await b.page.getByPlaceholder('0.00').nth(1).fill('1000');
				await b.page.getByRole('button', { name: new RegExp(`Place ${takerSide.toLowerCase()} limit`, 'i') }).click();
				result.accept = await banner(b.page, `B-${dir.name}`, '05-accept', 120_000);
			}
			result.settled = /settled/i.test(JSON.stringify(result.accept ?? '')) && !/gate|stopped/i.test(JSON.stringify(result.accept ?? ''));
		} finally {
			result.status = result.settled ? 'PASS' : 'FAIL';
			fs.mkdirSync(OUT, { recursive: true });
			fs.writeFileSync(`${OUT}/${dir.name}.json`, JSON.stringify({ result, log }, null, 1));
			await a.context.close();
			await b.context.close();
		}
		expect(result.settled, JSON.stringify(result)).toBe(true);
	});
}
