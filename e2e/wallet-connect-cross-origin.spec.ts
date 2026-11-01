/**
 * ADR-0008 cross-origin wallet connect, against a served wallet (dev or local).
 *
 * Real browser, real wallet worker and real WASM node on the wallet origin.
 * The connected apps are pages fulfilled by Playwright under their real HTTPS
 * origins (the browser reports that origin to the wallet), running the shipped
 * `@extro/node/wallet-connect` client. Cases: granted, denied (user reject,
 * scope over ceiling, non-allowlisted origin), revoked, and the spend confirm
 * boundary (reject and confirm). Only public BIP39 test vectors are used; the
 * spend op is a malformed hook that cannot move value.
 *
 * Env: E2E_WALLET_URL (e.g. https://dev.weby.cash/wallet), E2E_APP_ORIGIN (an
 * origin in the served connected_apps), E2E_EVIDENCE_DIR.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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
<button id="connect">Connect wallet</button>
<script type="module">
import { WalletPopup } from '/sdk/wallet-connect.js';
const W = (window.W = { popup: null, grant: null, connected: null });
const fail = (e) => ({ ok: false, code: e && e.code, message: String(e && e.message) });
document.getElementById('connect').onclick = () => {
	try {
		W.popup = WalletPopup.open({ walletHomeOrigin: ${JSON.stringify(WALLET_ORIGIN)}, path: ${JSON.stringify(CONNECT_PATH)}, timeoutMs: window.TIMEOUT_MS ?? 90000 });
	} catch (e) { W.connected = Promise.resolve(fail(e)); return; }
	W.connected = W.popup.connect(window.SCOPES ?? []).then(
		(g) => { W.grant = g; return { ok: true, scopes: g.scopes, fingerprint: g.identity.fingerprint_hex, tokenBytes: g.token.length }; },
		fail
	);
};
W.request = (op) => W.popup.request(W.grant, op).then((r) => ({ ok: true, response: JSON.parse(JSON.stringify(r, (_k, v) => (v instanceof Uint8Array ? 'bytes:' + v.length : v))) }), fail);
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

/** Restore the public test-vector wallet on the wallet origin (no encryption). */
async function onboardWallet(context: BrowserContext) {
	const page = await context.newPage();
	await page.goto(`${WALLET_URL}/`);
	const rc = await page.evaluate(async (u) => (await fetch(`${u}/runtime-config.json`)).json(), WALLET_URL);
	if (rc.deployment !== 'development' && process.env.E2E_ALLOW_LOCAL !== '1') {
		throw new Error(`refusing: wallet is not a development tier (${rc.deployment})`);
	}
	record('served_config', {
		deployment: rc.deployment,
		wallet_home_origin: rc.wallet_home_origin,
		connected_apps: rc.connected_apps,
		grant_ttl_secs: rc.grant_ttl_secs,
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
	await app.evaluate(([s, t]) => Object.assign(window, { SCOPES: s, TIMEOUT_MS: t }), [scopes, timeoutMs] as const);
	const popupPromise = context.waitForEvent('page');
	await app.click('#connect');
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded');
	return { app, popup };
}

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

test('wallet connect: headers, granted, revoked, spend boundary, denied', async ({ browser, request }) => {
	test.setTimeout(600_000);
	const context = await browser.newContext();
	await serveApp(context, APP_ORIGIN);
	await serveApp(context, EVIL_ORIGIN);

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

	await onboardWallet(context);

	// Granted: consent shows the exact origin; the grant is usable for a read op.
	const g = await openApp(context, APP_ORIGIN, ['WalletRead(pgp)']);
	await g.popup.getByTestId('connect-consent').waitFor({ timeout: 120_000 });
	const shownOrigin = await g.popup.getByTestId('connect-origin').textContent();
	expect(shownOrigin).toBe(APP_ORIGIN);
	await g.popup.getByTestId('connect-approve').click();
	const grant = await connected(g.app);
	record('granted', { shownOrigin, grant });
	expect(grant.ok).toBe(true);
	const read = await g.app.evaluate((op) => (window as any).W.request(op), readOp);
	record('granted_read', read);
	expect(read.ok).toBe(true);
	expect(read.response.kind).toBe('Ok');

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

	// Revoked: the wallet revokes the grant; the same token is refused.
	const token: number[] = await g.app.evaluate(() => Array.from((window as any).W.grant.token as Uint8Array));
	const revoke = await g.popup.evaluate(async (bytes) => {
		const client = (window as any).__extro;
		if (!client) return { ok: false, message: '__extro not exposed (not a development tier)' };
		const r = await client.send({
			request_id: crypto.getRandomValues(new Uint8Array(16)),
			op: { kind: 'Wallet', cmd: { op: 'RevokeCapToken', token: new Uint8Array(bytes) } }
		});
		return { ok: r.kind === 'Ok', kind: r.kind };
	}, token);
	record('revoke', revoke);
	expect(revoke.ok).toBe(true);
	const afterRevoke = await g.app.evaluate((op) => (window as any).W.request(op), readOp);
	record('revoked_read', afterRevoke);
	expect(afterRevoke.ok && afterRevoke.response.kind === 'Ok').toBe(false);
	await g.popup.close();
	await g.app.close();

	// Denied by the user.
	const d = await openApp(context, APP_ORIGIN, ['WalletRead(pgp)']);
	await d.popup.getByTestId('connect-consent').waitFor({ timeout: 120_000 });
	await d.popup.getByTestId('connect-reject').click();
	const denied = await connected(d.app);
	record('denied_user', denied);
	expect(denied).toMatchObject({ ok: false, code: 'UserRejected' });
	await d.app.close();

	// Denied: a spend scope can never be granted by token.
	const s = await openApp(context, APP_ORIGIN, ['Rail402(webcash)']);
	const overCeiling = await connected(s.app);
	record('denied_scope', overCeiling);
	expect(overCeiling).toMatchObject({ ok: false, code: 'ScopeNotAllowed' });
	await s.app.close();

	// Denied: a site not in connected_apps never gets an answer or a prompt.
	const e = await openApp(context, EVIL_ORIGIN, ['WalletRead(pgp)'], 20_000);
	const evil = await connected(e.app);
	const evilPrompt = await e.popup.getByTestId('connect-consent').count();
	const evilStatus = await status(e.popup).catch(() => null);
	record('denied_origin', { evil, evilPrompt, evilStatus });
	expect(evil).toMatchObject({ ok: false, code: 'Timeout' });
	expect(evilPrompt).toBe(0);

	await context.close();
});
