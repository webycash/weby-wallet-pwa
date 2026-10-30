/**
 * Exchange prod gate — UI-ONLY two-browser run on live CF dev (no __extro calls).
 * A: Markets → pair → Trade → Publish order. B: Markets → pair → Trade → sees order → Place limit (Accept→runSwap).
 * Records every banner / named gate as evidence. Never asserts a fake "settled".
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';

const BASE = (process.env.E2E_BASE_URL ?? 'https://dev.weby.cash/wallet').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/exchange-ui';
const DEFAULT_MNEMONICS = [
	'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
	'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'
];
// Staging (mainnet) runs pass E2E_MNEMONICS_FILE pointing at a JSON {A,B} kept
// outside git (SENSITIVE); the phrases are never logged.
const MNEMONICS: string[] = process.env.E2E_MNEMONICS_FILE
	? (() => {
			const j = JSON.parse(fs.readFileSync(process.env.E2E_MNEMONICS_FILE!, 'utf8'));
			return [j.A, j.B];
		})()
	: DEFAULT_MNEMONICS;
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
	// ToS: wait for the dialog explicitly (it renders after the WASM boot) and
	// tick it via the checkbox role when present, else the label text.
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
	await shot(page, who, '01-onboarded');
	note(who, 'onboarded');
	return { context, page };
}

async function connection(page: Page) {
	return page.evaluate(() => {
		const raw = localStorage.getItem('extro_connection_status_v1');
		return raw ? JSON.parse(raw) : null;
	});
}

async function waitPeers(page: Page, who: string, timeoutMs = 240_000) {
	const t0 = Date.now();
	let st: any = null;
	while (Date.now() - t0 < timeoutMs) {
		st = await connection(page);
		if (st && Number(st.peers_connected) > 0) break;
		await page.waitForTimeout(3000);
	}
	note(who, 'connection', st);
	return st;
}

/** UI-read balances: Webcash hero + Bitcoin→ARK view (off-chain + boarding). */
async function balances(page: Page, who: string, step: string) {
	const out: Record<string, unknown> = {};
	try {
		await page.getByRole('button', { name: /^Webcash$/ }).first().click();
		await page.waitForTimeout(1500);
		out.webcash = await page.locator('p.text-6xl').first().innerText({ timeout: 10_000 });
	} catch (e) {
		out.webcash_error = String(e).slice(0, 200);
	}
	try {
		await page.getByRole('button', { name: /^Bitcoin$/ }).first().click();
		await page.getByRole('button', { name: /^ARK$/ }).first().click();
		const ark = page.getByTestId('ark-view');
		await ark.waitFor({ timeout: 20_000 });
		await page
			.locator('[data-testid="ark-balance"], [data-testid="ark-error"]')
			.first()
			.waitFor({ timeout: 45_000 })
			.catch(() => {});
		out.ark = await ark.innerText();
	} catch (e) {
		out.ark_error = String(e).slice(0, 200);
	}
	note(who, `balances-${step}`, out);
	await shot(page, who, `balances-${step}`);
	return out;
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

const TERMINAL = new Set(['gate', 'error', 'settled', 'material-received']);

async function terminalPhase(page: Page, testId: string, who: string, step: string, timeoutMs = 300_000) {
	const t0 = Date.now();
	let phase: string | null = null;
	let text: string | null = null;
	let role: string | null = null;
	const trail: string[] = [];
	while (Date.now() - t0 < timeoutMs) {
		const el = page.getByTestId(testId).first();
		if (await el.isVisible().catch(() => false)) {
			phase = await el.getAttribute('data-phase');
			role = await el.getAttribute('data-role');
			text = await el.innerText().catch(() => null);
			if (phase && trail[trail.length - 1] !== phase) trail.push(phase);
			if (phase && TERMINAL.has(phase)) break;
		}
		await page.waitForTimeout(1500);
	}
	const gateMatch = text?.match(/ARK_[A-Z_]+/);
	const out = { phase, role, text, trail, gate: gateMatch ? gateMatch[0] : null, ms: Date.now() - t0 };
	note(who, step, out);
	await shot(page, who, step);
	return out;
}

for (const dir of [
	{ name: 'webcash-to-ark', pair: /Webcash.*(Ark|ARK)|(Ark|ARK).*Webcash/, makerSide: 'Sell' },
	{ name: 'ark-to-webcash', pair: /Webcash.*(Ark|ARK)|(Ark|ARK).*Webcash/, makerSide: 'Buy' }
] as const) {
	test(`exchange UI two-browser ${dir.name}`, async ({ browser }) => {
		test.setTimeout(900_000);
		const result: Record<string, unknown> = { direction: dir.name, base: BASE };
		const a = await onboard(browser, `A-${dir.name}`, MNEMONICS[0]);
		const b = await onboard(browser, `B-${dir.name}`, MNEMONICS[1]);
		try {
			result.balancesBefore = {
				A: await balances(a.page, `A-${dir.name}`, 'before'),
				B: await balances(b.page, `B-${dir.name}`, 'before')
			};
			result.connection = {
				A: await waitPeers(a.page, `A-${dir.name}`),
				B: await waitPeers(b.page, `B-${dir.name}`, 30_000)
			};
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
				// Both roles run concurrently: taker B (accept → its role) and maker A
				// (background responder → its role). Wait for a terminal phase on each.
				const [taker, maker] = await Promise.all([
					terminalPhase(b.page, 'swap-progress', `B-${dir.name}`, '05-taker-swap'),
					terminalPhase(a.page, 'maker-response', `A-${dir.name}`, '06-maker-swap')
				]);
				result.taker = taker;
				result.maker = maker;
				result.accept = await banner(b.page, `B-${dir.name}`, '07-accept-banner', 5_000);
				result.makerResponderDiag = await a.page
					.getByTestId('maker-responder-diag')
					.innerText()
					.catch(() => null);
				result.makerResponderError = (await a.page.getByTestId('maker-responder-error').isVisible())
					? await a.page.getByTestId('maker-responder-error').innerText()
					: null;
				const mr = a.page.getByTestId('maker-responder');
				result.makerResponder = (await mr.isVisible()) ? await mr.innerText() : null;
				result.gates = [taker.gate, maker.gate].filter(Boolean);
			}
			result.balancesAfter = {
				A: await balances(a.page, `A-${dir.name}`, 'after'),
				B: await balances(b.page, `B-${dir.name}`, 'after')
			};
			result.settled =
				(result.taker as any)?.phase === 'settled' && (result.maker as any)?.phase === 'settled';
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
