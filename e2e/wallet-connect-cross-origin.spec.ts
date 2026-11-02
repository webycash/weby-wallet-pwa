/**
 * ADR-0008 cross-origin wallet connect, against a served wallet (dev or local).
 *
 * Real browser, real wallet worker and real WASM node on the wallet origin.
 * The connected apps are pages fulfilled by Playwright under their real HTTPS
 * origins (the browser reports that origin to the wallet), running the shipped
 * `@extro/node/wallet-connect` client. Signing in to a site with the Extro
 * identity lasts until the user disconnects it: it survives an app reload and
 * a browser restart (on-disk profiles), a disconnect on a second device (same
 * identity) reaches the first through the wallet home, and the app can
 * disconnect itself. Also: the spend confirm boundary (reject and confirm) and
 * denials (user reject, scope over ceiling, non-allowlisted origin). Only public BIP39 test vectors are used; the
 * spend op is a malformed hook that cannot move value.
 *
 * Env: E2E_WALLET_URL (e.g. https://dev.weby.cash/wallet), E2E_APP_ORIGIN (an
 * origin in the served connected_apps), E2E_EVIDENCE_DIR.
 */
import { chromium, expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { TEST_MNEMONICS } from './fixtures/real-node';

const WALLET_URL = (process.env.E2E_WALLET_URL ?? '').replace(/\/$/, '');
const WALLET_ORIGIN = WALLET_URL ? new URL(WALLET_URL).origin : '';
const CONNECT_PATH = WALLET_URL ? `${new URL(WALLET_URL).pathname.replace(/\/$/, '')}/connect` : '';
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? '';
const EVIL_ORIGIN = 'https://evil.example';
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/wallet-connect';
const SDK_DIR = path.resolve('node_modules/@extro/node/js/dist');

const evidence: Record<string, unknown> = {};
const record = (key: string, value: unknown) => {
	evidence[key] = value;
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(`${OUT}/wallet-connect.json`, JSON.stringify(evidence, null, 1));
};

const appHtml = (origin: string) => `<!doctype html><html><head><title>app ${origin}</title></head><body>
<button id="connect">Sign in with Extro</button>
<button id="reopen">Use wallet</button>
<script type="module">
import { WalletPopup, keepConnection, keptConnection, forgetConnection } from '/sdk/wallet-connect.js';
const HOME = ${JSON.stringify(WALLET_ORIGIN)};
const W = (window.W = { popup: null, grant: null, connected: null });
const fail = (e) => ({ ok: false, code: e && e.code, message: String(e && e.message) });
const open = () => WalletPopup.open({ walletHomeOrigin: HOME, path: ${JSON.stringify(CONNECT_PATH)}, timeoutMs: window.TIMEOUT_MS ?? 90000 });
document.getElementById('connect').onclick = () => {
	try { W.popup = open(); } catch (e) { W.connected = Promise.resolve(fail(e)); return; }
	W.connected = W.popup.connect(window.SCOPES ?? []).then(
		(g) => { W.grant = g; keepConnection(localStorage, HOME, g); return { ok: true, scopes: g.scopes, connection_id: g.connection_id, fingerprint: g.identity.fingerprint_hex, tokenBytes: g.token.length }; },
		fail
	);
};
// After a reload or a browser restart: the app's kept sign-in, a fresh popup.
document.getElementById('reopen').onclick = () => {
	W.grant = keptConnection(localStorage, HOME);
	W.popup = open();
};
W.kept = () => keptConnection(localStorage, HOME)?.connection_id ?? null;
W.request = (op) => W.popup.request(W.grant, op).then(
	(r) => ({ ok: true, response: JSON.parse(JSON.stringify(r, (_k, v) => (v instanceof Uint8Array ? 'bytes:' + v.length : v))) }),
	(e) => { if (e && e.code === 'Disconnected') forgetConnection(localStorage, HOME); return fail(e); }
);
W.disconnect = () => W.popup.disconnect(W.grant).then(() => { forgetConnection(localStorage, HOME); return { ok: true }; }, fail);
</script></body></html>`;

async function serveApp(context: BrowserContext, origin: string) {
	await context.route(`${origin}/**`, async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.startsWith('/sdk/')) {
			const file = path.join(SDK_DIR, path.basename(url.pathname));
			return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file, 'utf8') });
		}
		return route.fulfill({ status: 200, contentType: 'text/html', body: appHtml(origin) });
	});
}

/** Restore the public test-vector wallet on the wallet origin (no encryption).
 * Two devices restoring the same phrase hold the same Extro identity. */
async function onboardWallet(context: BrowserContext) {
	const page = await context.newPage();
	await page.goto(`${WALLET_URL}/`);
	const rc = await page.evaluate(async (u) => (await fetch(`${u}/runtime-config.json`)).json(), WALLET_URL);
	// Production smoke is opt-in (E2E_ALLOW_PRODUCTION=1): the run restores the
	// public test vector, connects, reads, and sends only a malformed spend that
	// fails decoding, so no value moves on any tier.
	const allowed =
		rc.deployment === 'development' ||
		process.env.E2E_ALLOW_LOCAL === '1' ||
		(rc.deployment === 'production' && process.env.E2E_ALLOW_PRODUCTION === '1');
	if (!allowed) throw new Error(`refusing: wallet tier ${rc.deployment} needs an explicit opt-in`);
	record('served_config', {
		deployment: rc.deployment,
		wallet_home_origin: rc.wallet_home_origin,
		connected_apps: rc.connected_apps,
		legacy_wallet_origins: rc.legacy_wallet_origins
	});
	const tos = page.getByText('I accept the terms');
	await tos.waitFor({ timeout: 60_000 });
	const box = page.getByRole('checkbox').first();
	if (await box.isVisible().catch(() => false)) await box.check().catch(() => tos.click());
	else await tos.click();
	await page.getByRole('button', { name: /^Continue$/ }).click();
	await page.getByRole('button', { name: /Recover/ }).first().click();
	await page.getByPlaceholder('24 words or 64-char hex...').fill(TEST_MNEMONICS.A);
	await page.getByRole('button', { name: /^Recover$/ }).click();
	const skip = page.getByRole('button', { name: /Skip Encryption/ });
	await skip.waitFor({ timeout: 90_000 }).catch(() => {});
	if (await skip.isVisible()) {
		await page.getByText('No encryption').click();
		await skip.click();
	}
	await page.getByRole('button', { name: /^Exchange$/ }).first().waitFor({ timeout: 90_000 });
	await page.close();
}

async function openApp(context: BrowserContext, origin: string, scopes: string[], timeoutMs = 90_000) {
	const app = await context.newPage();
	await app.goto(`${origin}/`);
	return { app, popup: await click(context, app, '#connect', scopes, timeoutMs) };
}

/** Click an app button that opens the wallet popup; returns the popup. */
async function click(context: BrowserContext, app: Page, selector: string, scopes: string[] = [], timeoutMs = 90_000) {
	await app.evaluate(([s, t]) => Object.assign(window, { SCOPES: s, TIMEOUT_MS: t }), [scopes, timeoutMs] as const);
	const popupPromise = context.waitForEvent('page');
	await app.click(selector);
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');
	return popup;
}

/** A browser profile on disk: a device whose storage survives a restart. */
async function device(dir: string) {
	const context = await chromium.launchPersistentContext(dir, { headless: true });
	await serveApp(context, APP_ORIGIN);
	await serveApp(context, EVIL_ORIGIN);
	return context;
}

/** The wallet home's Connected sites panel (Settings), after it synced. */
async function connectedSites(context: BrowserContext) {
	const page = await context.newPage();
	await page.goto(`${WALLET_URL}/`);
	await page.getByRole('button', { name: /^Settings$/ }).first().click();
	const panel = page.getByTestId('connected-sites');
	await panel.waitFor({ timeout: 90_000 });
	const sync = panel.getByTestId('connected-sites-sync');
	await expect(sync).not.toHaveAttribute('data-sync', 'syncing', { timeout: 90_000 });
	await panel.locator('[data-testid=connected-site], [data-testid=connected-sites-empty], [data-testid=connected-sites-message]').first().waitFor({ timeout: 30_000 });
	return { page, panel, sync: await sync.getAttribute('data-sync') };
}
const sitesOf = (panel: Locator) =>
	panel.getByTestId('connected-site').evaluateAll((els) => els.map((e) => ({ origin: e.getAttribute('data-origin'), id: e.getAttribute('data-id') })));

const connected = (app: Page) => app.evaluate(() => (window as any).W.connected);
const status = (popup: Page) => popup.locator('[data-testid=connect-status]').getAttribute('data-status');
const readOp = { kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot: 0 } };
/** Value-moving class (tier spend) but malformed: decoding fails, nothing moves. */
const spendOp = () => ({
	kind: 'Hook',
	cmd: { op: 'Invalidate', signed_request: new Uint8Array([1, 2, 3, 4]), signer_vk: new Uint8Array(32), swap_id: new Uint8Array(16) }
});

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	if (!WALLET_URL || !APP_ORIGIN) throw new Error('set E2E_WALLET_URL and E2E_APP_ORIGIN');
});

test('wallet connect: sign-in persists until disconnected; disconnect syncs across devices', async ({ request }) => {
	test.setTimeout(900_000);
	const profiles = fs.mkdtempSync(path.join(os.tmpdir(), 'extro-connect-'));
	const dirA = path.join(profiles, 'device-a');
	const dirB = path.join(profiles, 'device-b');
	let a = await device(dirA);

	// Headers: connect page keeps its opener, every other wallet page is isolated, nothing frames it.
	const head = async (u: string) => {
		const r = await request.get(u);
		return { url: u, status: r.status(), coop: r.headers()['cross-origin-opener-policy'] ?? null, frame: /frame-ancestors 'none'/.test(r.headers()['content-security-policy'] ?? '') };
	};
	const headers = { connect: await head(`${WALLET_ORIGIN}${CONNECT_PATH}`), root: await head(`${WALLET_URL}/`) };
	record('headers', headers);
	expect(headers.connect.coop).toBe('unsafe-none');
	expect(headers.root.coop).toBe('same-origin');
	expect(headers.connect.frame && headers.root.frame).toBe(true);

	await onboardWallet(a);

	// The test identity is fixed, and its sign-ins persist (synced) until
	// disconnected: start from the home with every site disconnected, the way
	// a user would, so the first sign-in below asks for consent.
	const start = await connectedSites(a);
	const leftover = await sitesOf(start.panel);
	for (const site of leftover) {
		const row = start.panel.locator(`[data-testid=connected-site][data-id="${site.id}"]`);
		await row.getByTestId('connected-site-disconnect').click();
		await expect(row).toHaveCount(0, { timeout: 60_000 });
	}
	await expect(start.panel.getByTestId('connected-sites-sync')).toHaveAttribute('data-sync', 'synced', { timeout: 60_000 });
	record('home_a_start', { sync: start.sync, disconnected: leftover });
	await start.page.close();

	// Sign in: consent names the exact origin and says it lasts until disconnected.
	const g = await openApp(a, APP_ORIGIN, ['WalletRead(pgp)']);
	await g.popup.getByTestId('connect-consent').waitFor({ timeout: 120_000 });
	const shownOrigin = await g.popup.getByTestId('connect-origin').textContent();
	const consentText = ((await g.popup.getByTestId('connect-consent').textContent()) ?? '').replace(/\s+/g, ' ');
	expect(shownOrigin).toBe(APP_ORIGIN);
	expect(consentText).toContain('until you disconnect');
	expect(consentText).not.toMatch(/minutes?|hours?/);
	await g.popup.getByTestId('connect-approve').click();
	const grant = await connected(g.app);
	record('signed_in', { shownOrigin, consentText, grant });
	expect(grant.ok).toBe(true);
	const read = await g.app.evaluate((op) => (window as any).W.request(op), readOp);
	record('signed_in_read', read);
	expect(read.ok && read.response.kind).toBe('Ok');

	// Spend boundary: reject → UserRejected; confirm → reaches the node (malformed op errors there).
	const rejected = g.app.evaluate((op) => (window as any).W.request(op), spendOp());
	await g.popup.getByTestId('connect-confirm').waitFor();
	await g.popup.getByTestId('confirm-reject').click();
	const spendRejected = await rejected;
	record('spend_rejected', spendRejected);
	expect(spendRejected).toMatchObject({ ok: false, code: 'UserRejected' });
	const confirmed = g.app.evaluate(
		() =>
			(window as any).W.request({
				kind: 'Hook',
				cmd: { op: 'Invalidate', signed_request: new Uint8Array([1, 2, 3, 4]), signer_vk: new Uint8Array(32), swap_id: new Uint8Array(16) }
			})
	);
	await g.popup.getByTestId('connect-confirm').waitFor();
	await g.popup.getByTestId('confirm-approve').click();
	const spendConfirmed = await confirmed;
	record('spend_confirmed', spendConfirmed);
	expect(spendConfirmed.ok).toBe(true);
	expect(JSON.stringify(spendConfirmed.response)).not.toContain('ConfirmationRequired');
	await g.popup.close();

	// Reload: the app keeps its sign-in; a fresh popup serves it with no prompt.
	await g.app.reload();
	const p1 = await click(a, g.app, '#reopen');
	const afterReload = await g.app.evaluate((op) => (window as any).W.request(op), readOp);
	const reloadPrompts = await p1.getByTestId('connect-consent').count();
	record('after_reload', { kept: await g.app.evaluate(() => (window as any).W.kept()), read: afterReload, prompts: reloadPrompts });
	expect(afterReload.ok && afterReload.response.kind).toBe('Ok');
	expect(reloadPrompts).toBe(0);
	await p1.close();

	// Signing in again with granted scopes: no prompt, same identity.
	const again = await click(a, g.app, '#connect', ['WalletRead(pgp)']);
	const regrant = await connected(g.app);
	record('sign_in_again', { regrant, prompts: await again.getByTestId('connect-consent').count() });
	expect(regrant.ok).toBe(true);
	expect(regrant.fingerprint).toBe(grant.fingerprint);
	await again.close();

	// Restart: close the browser, start it again on the same profile.
	await a.close();
	a = await device(dirA);
	const restarted = await a.newPage();
	await restarted.goto(`${APP_ORIGIN}/`);
	const p2 = await click(a, restarted, '#reopen');
	const afterRestart = await restarted.evaluate((op) => (window as any).W.request(op), readOp);
	record('after_restart', { kept: await restarted.evaluate(() => (window as any).W.kept()), read: afterRestart, prompts: await p2.getByTestId('connect-consent').count() });
	expect(afterRestart.ok && afterRestart.response.kind).toBe('Ok');
	await p2.close();

	// Device A's wallet home lists the site.
	const homeA = await connectedSites(a);
	const sitesA = await sitesOf(homeA.panel);
	record('home_a', { sync: homeA.sync, sites: sitesA });
	expect(homeA.sync).toBe('synced');
	expect(sitesA).toContainEqual({ origin: APP_ORIGIN, id: regrant.connection_id });
	await homeA.page.close();

	// Device B: the same identity on another browser sees the site, and disconnects it.
	const b = await device(dirB);
	await onboardWallet(b);
	const homeB = await connectedSites(b);
	const sitesB = await sitesOf(homeB.panel);
	record('home_b_before', { sync: homeB.sync, sites: sitesB });
	expect(homeB.sync).toBe('synced');
	expect(sitesB).toContainEqual({ origin: APP_ORIGIN, id: regrant.connection_id });
	await homeB.panel.locator(`[data-testid=connected-site][data-id="${regrant.connection_id}"]`).getByTestId('connected-site-disconnect').click();
	await expect(homeB.panel.locator(`[data-testid=connected-site][data-id="${regrant.connection_id}"]`)).toHaveCount(0, { timeout: 60_000 });
	const syncB = await homeB.panel.getByTestId('connected-sites-sync').getAttribute('data-sync');
	record('home_b_disconnect', { sync: syncB });
	expect(syncB).toBe('synced');
	await b.close();

	// Back on device A: the disconnect arrived; the app is told and forgets its sign-in.
	const p3 = await click(a, restarted, '#reopen');
	const afterRemote = await restarted.evaluate((op) => (window as any).W.request(op), readOp);
	const keptAfter = await restarted.evaluate(() => (window as any).W.kept());
	record('after_remote_disconnect', { read: afterRemote, kept: keptAfter });
	expect(afterRemote).toMatchObject({ ok: false, code: 'Disconnected' });
	expect(keptAfter).toBeNull();
	await p3.close();
	const homeA2 = await connectedSites(a);
	const sitesA2 = await sitesOf(homeA2.panel);
	record('home_a_after', { sync: homeA2.sync, sites: sitesA2 });
	expect(sitesA2.map((x) => x.id)).not.toContain(regrant.connection_id);
	await homeA2.page.close();

	// Disconnect from the app itself.
	const s2 = await click(a, restarted, '#connect', ['WalletRead(pgp)']);
	await s2.getByTestId('connect-consent').waitFor({ timeout: 120_000 });
	await s2.getByTestId('connect-approve').click();
	const fresh = await connected(restarted);
	expect(fresh.ok).toBe(true);
	const appDisconnect = await restarted.evaluate(() => (window as any).W.disconnect());
	const afterAppDisconnect = await restarted.evaluate((op) => (window as any).W.request(op), readOp);
	record('app_disconnect', { fresh, appDisconnect, read: afterAppDisconnect });
	expect(appDisconnect.ok).toBe(true);
	expect(afterAppDisconnect).toMatchObject({ ok: false, code: 'Disconnected' });
	await s2.close();
	await restarted.close();

	// Denied by the user.
	const d = await openApp(a, APP_ORIGIN, ['WalletRead(pgp)']);
	await d.popup.getByTestId('connect-consent').waitFor({ timeout: 120_000 });
	await d.popup.getByTestId('connect-reject').click();
	const denied = await connected(d.app);
	record('denied_user', denied);
	expect(denied).toMatchObject({ ok: false, code: 'UserRejected' });
	await d.popup.close().catch(() => {});
	await d.app.close();

	// Denied: a spend scope can never be granted by token.
	const s = await openApp(a, APP_ORIGIN, ['Rail402(webcash)']);
	const overCeiling = await connected(s.app);
	record('denied_scope', overCeiling);
	expect(overCeiling).toMatchObject({ ok: false, code: 'ScopeNotAllowed' });
	await s.popup.close().catch(() => {});
	await s.app.close();

	// Denied: a site not in connected_apps never gets an answer or a prompt.
	const e = await openApp(a, EVIL_ORIGIN, ['WalletRead(pgp)'], 20_000);
	const evil = await connected(e.app);
	const evilPrompt = await e.popup.getByTestId('connect-consent').count();
	const evilStatus = await status(e.popup).catch(() => null);
	record('denied_origin', { evil, evilPrompt, evilStatus });
	expect(evil).toMatchObject({ ok: false, code: 'Timeout' });
	expect(evilPrompt).toBe(0);

	await a.close();
});
