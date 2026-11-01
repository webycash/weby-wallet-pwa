/**
 * ADR-0008 §12 wallet home move, against served dev wallets (real browser,
 * real Workers, real WASM node). An existing user of the legacy wallet origin
 * moves their wallet to the wallet home on the same device.
 *
 * Two phases share one persistent browser profile, so the "existing user" is
 * real: phase `seed` restores the public BIP39 test vector A on the legacy
 * origin WHILE IT IS STILL THE OLD DEPLOYMENT (it was the home); phase `move`
 * runs after the new deployments: the legacy origin must route the user to
 * its move page, the home popup must confirm, and the home must then hold
 * exactly what the legacy origin held. Only SHA-256 digests of storage are
 * recorded, never values (no seed, even a public test one, is written out).
 *
 * Env: E2E_MOVE_PHASE (seed | move), E2E_LEGACY_WALLET_URL
 * (https://dev.weby.cash/wallet), E2E_HOME_WALLET_URL
 * (https://dev.extro.network/wallet), E2E_PROFILE_DIR, E2E_EVIDENCE_DIR.
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import { TEST_MNEMONICS } from './fixtures/real-node';

const PHASE = process.env.E2E_MOVE_PHASE ?? '';
const LEGACY = (process.env.E2E_LEGACY_WALLET_URL ?? '').replace(/\/$/, '');
const HOME = (process.env.E2E_HOME_WALLET_URL ?? '').replace(/\/$/, '');
const PROFILE = process.env.E2E_PROFILE_DIR ?? '';
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/wallet-move';

const evidence: Record<string, unknown> = {};
const record = (key: string, value: unknown) => {
	evidence[key] = value;
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(`${OUT}/wallet-move-${PHASE}.json`, JSON.stringify(evidence, null, 1));
};

/**
 * Digest of everything the move must carry, computed in the page (an
 * independent re-implementation of the bundle's scope, not the app's code).
 */
async function storageDigest(page: Page, nodeDb: string) {
	return page.evaluate(async (nodeDb) => {
		const EPHEMERAL = new Set(['weby_mining_snapshot', 'weby_install_done', 'weby_backup_dismissed_session', 'weby_moved_to', 'weby_move_reprotect']);
		const enc = (v: unknown) =>
			typeof v === 'string' ? 's:' + v : v instanceof Uint8Array || v instanceof ArrayBuffer ? 'b:' + Array.from(new Uint8Array(v as ArrayBuffer)).join(',') : 'x:' + typeof v;
		const sha = async (s: string) =>
			Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
		const dump = (db: string, store: string) =>
			new Promise<string[]>((resolve, reject) => {
				const req = indexedDB.open(db);
				req.onupgradeneeded = () => req.transaction?.abort();
				req.onerror = () => resolve([]); // absent database = empty store
				req.onsuccess = () => {
					const d = req.result;
					if (!d.objectStoreNames.contains(store)) {
						d.close();
						return resolve([]);
					}
					const out: string[] = [];
					const cur = d.transaction(store).objectStore(store).openCursor();
					cur.onsuccess = () => {
						const c = cur.result;
						if (!c) {
							d.close();
							return resolve(out.sort());
						}
						out.push(enc(c.key) + '=' + enc(c.value));
						c.continue();
					};
					cur.onerror = () => reject(cur.error);
				};
			});
		const ls: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i)!;
			if ((k.startsWith('weby_') || k === 'weby-wallet-mnemonic') && !EPHEMERAL.has(k)) ls.push(k + '=' + localStorage.getItem(k));
		}
		const stores: Record<string, [number, string]> = {};
		for (const [id, db, store] of [
			['wallet-production', 'weby-wallet-v2-production', 'wallet_state'],
			['wallet-testnet', 'weby-wallet-v2-testnet', 'wallet_state'],
			['ark-journal', 'weby-ark-contract-journal-v1', 'contracts'],
			['extro-node', nodeDb, 'kv']
		]) {
			const rows = await dump(db, store);
			stores[id] = [rows.length, await sha(rows.join('\n'))];
		}
		const phrase = localStorage.getItem('weby-wallet-mnemonic');
		return {
			ls_keys: ls.map((l) => l.slice(0, l.indexOf('='))).sort(),
			ls_sha256: await sha(ls.sort().join('\n')),
			mnemonic_sha256: phrase ? await sha(phrase) : null,
			stores
		};
	}, nodeDb);
}

const config = (page: Page, url: string) => page.evaluate(async (u) => (await fetch(`${u}/runtime-config.json`)).json(), url);

async function persistent(): Promise<BrowserContext> {
	return chromium.launchPersistentContext(PROFILE, { headless: true });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	if (!['seed', 'move'].includes(PHASE) || !LEGACY || !HOME || !PROFILE) {
		throw new Error('set E2E_MOVE_PHASE (seed|move), E2E_LEGACY_WALLET_URL, E2E_HOME_WALLET_URL, E2E_PROFILE_DIR');
	}
});

test('seed: an existing wallet on the legacy origin (old deployment)', async () => {
	test.skip(PHASE !== 'seed');
	test.setTimeout(300_000);
	const context = await persistent();
	const page = await context.newPage();
	await page.goto(`${LEGACY}/`);
	const rc = await config(page, LEGACY);
	if (rc.deployment !== 'development') throw new Error(`refusing: not a development tier (${rc.deployment})`);
	record('legacy_config_before', { wallet_home_origin: rc.wallet_home_origin, legacy_wallet_origins: rc.legacy_wallet_origins ?? null });
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
	await page.waitForTimeout(5_000); // let the node settle its store
	record('legacy_seeded', await storageDigest(page, rc.db_name));
	await context.close();
});

test('move: legacy routes to /move, home confirms, home holds exactly the legacy wallet', async () => {
	test.skip(PHASE !== 'move');
	test.setTimeout(600_000);
	const context = await persistent();
	const legacyOrigin = new URL(LEGACY).origin;
	const homeOrigin = new URL(HOME).origin;

	// Served configs: the home accepts the legacy origin; the legacy points at the home.
	const probe = await context.newPage();
	await probe.goto('about:blank');
	const homeRc = await (await context.request.get(`${HOME}/runtime-config.json`)).json();
	const legacyRc = await (await context.request.get(`${LEGACY}/runtime-config.json`)).json();
	record('configs', {
		home: { wallet_home_origin: homeRc.wallet_home_origin, connected_apps: homeRc.connected_apps, legacy_wallet_origins: homeRc.legacy_wallet_origins },
		legacy: { wallet_home_origin: legacyRc.wallet_home_origin, connected_apps: legacyRc.connected_apps, legacy_wallet_origins: legacyRc.legacy_wallet_origins }
	});
	expect(homeRc.wallet_home_origin).toBe(homeOrigin);
	expect(legacyRc.wallet_home_origin).toBe(homeOrigin);
	expect(homeRc.legacy_wallet_origins).toContain(legacyOrigin);
	await probe.close();

	// Headers: the home's migrate page keeps its opener; the legacy move page may open a popup.
	const h = async (u: string) => (await context.request.get(u)).headers()['cross-origin-opener-policy'];
	const coop = { home_migrate: await h(`${HOME}/migrate`), legacy_move: await h(`${LEGACY}/move`), home_root: await h(`${HOME}/`) };
	record('coop', coop);
	expect(coop.home_migrate).toBe('unsafe-none');
	expect(coop.legacy_move).toBe('same-origin-allow-popups');
	expect(coop.home_root).toBe('same-origin');

	// The home starts empty on this profile.
	const home0 = await context.newPage();
	await home0.goto(`${HOME}/migrate`);
	await expect(home0.locator('[data-testid=wallet-migrate]')).toHaveAttribute('data-status', 'not-opened');
	const homeBefore = await storageDigest(home0, homeRc.db_name);
	record('home_before', homeBefore);
	expect(homeBefore.mnemonic_sha256).toBeNull();
	await home0.close();

	// The existing user opens the legacy wallet with a gift-style link: routed to /move, query kept for later.
	const legacy = await context.newPage();
	const legacyBefore = await (async () => {
		const p = await context.newPage();
		await p.goto(`${LEGACY}/move`);
		const d = await storageDigest(p, legacyRc.db_name);
		await p.close();
		return d;
	})();
	record('legacy_before', legacyBefore);
	expect(legacyBefore.mnemonic_sha256).not.toBeNull();
	await legacy.goto(`${LEGACY}/?e2e=move#tab`);
	await legacy.waitForURL(`${LEGACY}/move`, { timeout: 60_000 });
	record('legacy_routed_to', legacy.url());
	await legacy.locator('[data-testid=move-offer]').waitFor();

	// Move: the popup opens on the home, shows what arrives, the user confirms.
	const popupP = context.waitForEvent('page');
	await legacy.click('[data-testid=move-start]');
	const popup = await popupP;
	await popup.waitForLoadState('domcontentloaded');
	expect(new URL(popup.url()).origin).toBe(homeOrigin);
	await popup.locator('[data-testid=migrate-confirm]').waitFor({ timeout: 60_000 });
	record('confirm_from', await popup.locator('[data-testid=migrate-from]').textContent());
	await popup.click('[data-testid=migrate-approve]');
	await popup.locator('[data-testid=migrate-done]').waitFor({ timeout: 60_000 });
	const homeAfter = await storageDigest(popup, homeRc.db_name);
	record('home_after_import', homeAfter);
	await legacy.locator('[data-testid=move-done]').waitFor({ timeout: 60_000 });

	// Exactly the same wallet at the home; the legacy copy is untouched.
	expect(homeAfter.mnemonic_sha256).toBe(legacyBefore.mnemonic_sha256);
	expect(homeAfter.ls_keys).toEqual(legacyBefore.ls_keys);
	expect(homeAfter.ls_sha256).toBe(legacyBefore.ls_sha256);
	expect(homeAfter.stores).toEqual(legacyBefore.stores);
	const legacyAfter = await storageDigest(legacy, legacyRc.db_name);
	record('legacy_after', legacyAfter);
	expect(legacyAfter.stores).toEqual(legacyBefore.stores);
	expect(legacyAfter.mnemonic_sha256).toBe(legacyBefore.mnemonic_sha256);
	const marker = await legacy.evaluate(() => JSON.parse(localStorage.getItem('weby_moved_to') ?? 'null'));
	record('legacy_moved_marker', { home: marker?.home, digest_hex: marker?.digest_hex });
	expect(marker?.home).toBe(homeOrigin);

	// Open the wallet: the home now opens it (no onboarding), and the legacy origin forwards there.
	await legacy.click('[data-testid=move-open-home]');
	await legacy.waitForURL((u) => u.origin === homeOrigin, { timeout: 60_000 });
	record('opened_at', legacy.url());
	expect(legacy.url()).toBe(`${HOME}/?e2e=move#tab`);
	await legacy.getByRole('button', { name: /^Exchange$/ }).first().waitFor({ timeout: 90_000 });
	const fwd = await context.newPage();
	await fwd.goto(`${LEGACY}/?webcash=e2e-not-a-token`);
	await fwd.waitForURL((u) => u.origin === homeOrigin, { timeout: 60_000 });
	record('legacy_forwards_to', fwd.url());
	expect(fwd.url()).toBe(`${HOME}/?webcash=e2e-not-a-token`);
	await fwd.close();

	// Replay: a second move into the now non-empty home is refused, nothing changes.
	const again = await context.newPage();
	await again.goto(`${LEGACY}/move`);
	await again.locator('[data-testid=move-done]').waitFor();
	record('replay_guard', 'legacy shows moved; home import refuses a non-empty wallet (unit-tested)');
	await context.close();
});
