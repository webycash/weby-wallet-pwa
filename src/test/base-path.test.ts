import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	checkBuiltBundle,
	resolveBuildBasePath,
	resolveTierBasePath
} from '../../scripts/base-path.mjs';

const repo = resolve(__dirname, '../..');
// Runtime import (dev-worker.js is plain Worker JS, outside the typed program).
const workerPath = join(repo, 'dev-worker.js');
type WorkerModule = { default: { fetch(r: Request, env: Record<string, unknown>): Promise<Response> } };

async function tierRoot(tier: string, toml: string) {
	const root = await mkdtemp(join(tmpdir(), 'base-path-'));
	await writeFile(join(root, `wrangler.${tier}.toml`), toml);
	return root;
}
const ASSETS = 'assets = { directory = "x-deploy", binding = "ASSETS", run_worker_first = true }\n';

describe('wallet base path fails closed (one source per tier)', () => {
	it('dev and staging resolve /wallet from their wrangler config and its route', () => {
		expect(resolveTierBasePath('dev', { root: repo })).toEqual({ base: '/wallet', assetsDir: 'dev-deploy' });
		expect(resolveTierBasePath('staging', { root: repo })).toEqual({ base: '/wallet', assetsDir: 'staging-deploy' });
	});

	it('a build without WALLET_TIER refuses; dev/test without it stays local', () => {
		expect(() => resolveBuildBasePath({}, ['node', 'vite', 'build'], { root: repo })).toThrow(/WALLET_TIER is required/);
		expect(resolveBuildBasePath({ WALLET_TIER: 'staging' }, ['node', 'vite', 'build'], { root: repo })).toBe('/wallet');
		expect(resolveBuildBasePath({}, ['node', 'vite', 'dev'], { root: repo })).toBe('');
	});

	it('a BASE_PATH that disagrees with the tier refuses', () => {
		expect(() => resolveTierBasePath('staging', { root: repo, env: { BASE_PATH: '/app' } })).toThrow(/disagrees/);
		expect(resolveTierBasePath('staging', { root: repo, env: { BASE_PATH: '/wallet' } }).base).toBe('/wallet');
	});

	it('missing base path, unknown tier, route mismatch and unserved tier refuse', async () => {
		expect(() => resolveTierBasePath('nope', { root: repo })).toThrow(/does not exist/);
		const missing = await tierRoot('t', `workers_dev = true\n${ASSETS}[vars]\nPUBLIC_DEPLOYMENT = "staging"\n`);
		expect(() => resolveTierBasePath('t', { root: missing })).toThrow(/WALLET_BASE_PATH is missing/);
		const empty = await tierRoot('t', `workers_dev = true\n${ASSETS}[vars]\nWALLET_BASE_PATH = ""\n`);
		expect(() => resolveTierBasePath('t', { root: empty })).toThrow(/one path segment/);
		const route = await tierRoot('t', `${ASSETS}[vars]\nWALLET_BASE_PATH = "/wallet"\n[[routes]]\npattern = "dev.weby.cash/app*"\n`);
		expect(() => resolveTierBasePath('t', { root: route })).toThrow(/does not serve \/wallet/);
		const unserved = await tierRoot('t', `${ASSETS}[vars]\nWALLET_BASE_PATH = "/wallet"\n`);
		expect(() => resolveTierBasePath('t', { root: unserved })).toThrow(/nothing serves/);
	});

	it('the built-bundle check rejects a root-based (/_app) shell', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bundle-'));
		await writeFile(join(dir, 'index.html'), '<link href="/_app/immutable/x.css"><script src="/_app/immutable/y.js"></script>');
		expect(checkBuiltBundle(dir, '/wallet').join('\n')).toMatch(/does not load \/wallet\/_app\/[\s\S]*root \/_app\//);
		await writeFile(join(dir, 'index.html'), '<link href="/wallet/_app/immutable/x.css"><script>import("/wallet/_app/immutable/y.js")</script>');
		expect(checkBuiltBundle(dir, '/wallet')).toEqual([]);
		const none = join(dir, 'none');
		await mkdir(none);
		expect(checkBuiltBundle(none, '/wallet')[0]).toMatch(/missing/);
	});

	it('the Worker serves from WALLET_BASE_PATH and refuses without it', async () => {
		const worker = ((await import(/* @vite-ignore */ workerPath)) as WorkerModule).default;
		const seen: string[] = [];
		const env = {
			ASSETS: { fetch: async (r: Request) => (seen.push(new URL(r.url).pathname), new Response('', { status: seen.length === 1 ? 404 : 200 })) }
		};
		const none = await worker.fetch(new Request('https://w.example/wallet/x'), env);
		expect(none.status).toBe(500);
		expect(seen).toEqual([]);
		const ok = await worker.fetch(new Request('https://w.example/wallet/trade'), { ...env, WALLET_BASE_PATH: '/wallet' });
		expect(ok.status).toBe(200);
		expect(seen).toEqual(['/wallet/trade', '/wallet/index.html']);
		const toml = await readFile(join(repo, 'wrangler.staging.toml'), 'utf8');
		expect(toml).toMatch(/^WALLET_BASE_PATH = "\/wallet"$/m);
	});
});
