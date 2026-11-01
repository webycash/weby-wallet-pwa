// The dev wallet runs as two Workers built from one bundle (ADR-0008 §12):
// the home (wrangler.extro-dev.toml, dev.extro.network/wallet) and the legacy
// path (wrangler.dev.toml, dev.weby.cash/wallet). Wrangler cannot share [vars]
// between files, so this pins that they differ ONLY in the wallet-access block,
// and that each one parses with the same strict validator the Worker uses.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRuntimeConfig, runtimeConfigFromPublicEnv } from '@extro/node/runtime-config';

const ROOT = resolve(__dirname, '../../..');
const WALLET_ACCESS = [
	'PUBLIC_WALLET_HOME_ORIGIN',
	'PUBLIC_CONNECTED_APPS_JSON',
	'PUBLIC_LEGACY_WALLET_ORIGINS_JSON'
];

function vars(file: string): Record<string, string> {
	const toml = readFileSync(resolve(ROOT, file), 'utf8');
	const block = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[[routes]]'));
	const out: Record<string, string> = {};
	for (const m of block.matchAll(/^([A-Z_0-9]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/gm)) out[m[1]] = m[2] ?? m[3];
	return out;
}

const home = vars('wrangler.extro-dev.toml');
const legacy = vars('wrangler.dev.toml');
const parse = (env: Record<string, string>) => parseRuntimeConfig(runtimeConfigFromPublicEnv(env));

describe('dev wallet home + legacy Worker configs', () => {
	it('share every var outside the wallet-access block', () => {
		const strip = (v: Record<string, string>) =>
			Object.fromEntries(Object.entries(v).filter(([k]) => !WALLET_ACCESS.includes(k)));
		expect(Object.keys(home).length).toBeGreaterThan(20);
		expect(strip(home)).toEqual(strip(legacy));
	});

	it('the home accepts the legacy origin; the legacy path serves no connect and no move', () => {
		const h = parse(home);
		const l = parse(legacy);
		expect(h.wallet_home_origin).toBe(l.wallet_home_origin);
		expect(h.legacy_wallet_origins).toEqual(['https://dev.weby.cash']);
		expect(h.connected_apps.map((a) => a.origin)).toEqual(['https://dev.weby.cash', 'https://dev.extro.life']);
		expect(l.connected_apps).toEqual([]);
		expect(l.legacy_wallet_origins).toEqual([]);
	});

	it('the home is served by the home Worker route and not by the legacy one', () => {
		const route = (file: string) => readFileSync(resolve(ROOT, file), 'utf8').match(/^pattern\s*=\s*"([^"/]+)/m)?.[1];
		expect(`https://${route('wrangler.extro-dev.toml')}`).toBe(parse(home).wallet_home_origin);
		expect(`https://${route('wrangler.dev.toml')}`).not.toBe(parse(legacy).wallet_home_origin);
		expect(parse(home).legacy_wallet_origins).toContain(`https://${route('wrangler.dev.toml')}`);
	});
});
