#!/usr/bin/env node
// Wallet base path, fail closed (2026-11-01: a staging build without
// BASE_PATH=/wallet requested its assets from /_app and broke the app).
//
// One config source per tier: `wrangler.<tier>.toml` [vars] WALLET_BASE_PATH.
// The same value is read by the build (svelte.config.js `kit.paths.base`), by
// the Worker (dev-worker.js serves `${WALLET_BASE_PATH}/…`), and is checked
// against the tier's Worker route. A `vite build` without WALLET_TIER, a tier
// without WALLET_BASE_PATH, a route that does not serve that path, or a stray
// BASE_PATH that disagrees refuses; the built bundle is checked afterwards.
//
// Usage:
//   node scripts/base-path.mjs --tier <dev|staging>          resolve + validate the tier
//   node scripts/base-path.mjs --tier <tier> --built build   + check a built bundle
//   node scripts/base-path.mjs --tier <tier> --deploy        + check <assets dir><base>/
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE_RE = /^\/[a-z0-9][a-z0-9-]*$/;

/**
 * Minimal reader for the wrangler fields this check needs.
 * @param {string} toml
 */
export function readTierConfig(toml) {
	const str = (/** @type {string} */ key) => toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
	return {
		basePath: str('WALLET_BASE_PATH'),
		workersDev: /^workers_dev\s*=\s*true\s*$/m.test(toml),
		routes: [...toml.matchAll(/^pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]),
		assetsDir: toml.match(/^assets\s*=\s*\{[^}]*directory\s*=\s*"([^"]+)"/m)?.[1]
	};
}

/**
 * Validate a tier's config; returns `{ base, assetsDir }` or throws.
 * @param {string | undefined} tier
 * @param {{ root?: string, env?: Record<string, string | undefined> }} [opts]
 * @returns {{ base: string, assetsDir: string }}
 */
export function resolveTierBasePath(tier, { root = ROOT, env = {} } = {}) {
	if (!tier) throw new Error('WALLET_TIER is required to build (dev | staging | production); it selects wrangler.<tier>.toml');
	if (!/^[a-z0-9-]+$/.test(tier)) throw new Error(`invalid WALLET_TIER ${JSON.stringify(tier)}`);
	const file = join(root, `wrangler.${tier}.toml`);
	if (!existsSync(file)) throw new Error(`WALLET_TIER=${tier}: ${file} does not exist`);
	const cfg = readTierConfig(readFileSync(file, 'utf8'));
	const where = `wrangler.${tier}.toml`;
	if (cfg.basePath === undefined) throw new Error(`${where}: [vars] WALLET_BASE_PATH is missing`);
	if (!BASE_RE.test(cfg.basePath)) {
		throw new Error(`${where}: WALLET_BASE_PATH ${JSON.stringify(cfg.basePath)} must be one path segment like "/wallet"`);
	}
	if (!cfg.assetsDir) throw new Error(`${where}: assets.directory is missing`);
	if (cfg.routes.length === 0 && !cfg.workersDev) {
		throw new Error(`${where}: no [[routes]] and workers_dev is not true; nothing serves ${cfg.basePath}`);
	}
	for (const pattern of cfg.routes) {
		const slash = pattern.indexOf('/');
		const path = slash < 0 ? '' : pattern.slice(slash);
		if (path !== `${cfg.basePath}*`) {
			throw new Error(`${where}: route ${JSON.stringify(pattern)} does not serve ${cfg.basePath} (expected <host>${cfg.basePath}*)`);
		}
	}
	if (env.BASE_PATH !== undefined && env.BASE_PATH !== '' && env.BASE_PATH !== cfg.basePath) {
		throw new Error(`BASE_PATH=${env.BASE_PATH} disagrees with ${where} WALLET_BASE_PATH=${cfg.basePath}`);
	}
	return { base: cfg.basePath, assetsDir: cfg.assetsDir };
}

/**
 * `kit.paths.base` for svelte.config.js. A build must name its tier.
 * @param {Record<string, string | undefined>} [env]
 * @param {string[]} [argv]
 * @param {{ root?: string }} [opts]
 * @returns {string}
 */
export function resolveBuildBasePath(env = process.env, argv = process.argv, opts = {}) {
	const isBuild = argv.slice(2).includes('build');
	if (env.WALLET_TIER || isBuild) return resolveTierBasePath(env.WALLET_TIER, { ...opts, env }).base;
	// vite dev / vitest / svelte-kit sync: local only, never deployed.
	return env.BASE_PATH || '';
}

/**
 * Problems with a built bundle for `base` (empty = ok).
 * @param {string} dir
 * @param {string} base
 * @returns {string[]}
 */
export function checkBuiltBundle(dir, base) {
	const index = join(dir, 'index.html');
	if (!existsSync(index)) return [`${index} missing`];
	const html = readFileSync(index, 'utf8');
	const problems = [];
	if (!html.includes(`${base}/_app/`)) problems.push(`${index} does not load ${base}/_app/`);
	if (/["'(]\/_app\//.test(html)) problems.push(`${index} loads root /_app/ (built without base ${base})`);
	return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const opt = (/** @type {string} */ name) => {
		const i = args.indexOf(name);
		return i < 0 ? undefined : args[i + 1];
	};
	try {
		const tier = opt('--tier') ?? process.env.WALLET_TIER;
		const { base, assetsDir } = resolveTierBasePath(tier, { env: process.env });
		const dirs = [];
		const built = opt('--built');
		if (built) dirs.push(resolve(built));
		if (args.includes('--deploy')) dirs.push(resolve(ROOT, assetsDir) + base);
		const problems = dirs.flatMap((d) => checkBuiltBundle(d, base));
		if (problems.length) throw new Error(problems.join('\n'));
		console.log(`[base-path] PASS: tier ${tier} base ${base}${dirs.length ? ` (${dirs.join(', ')})` : ''}`);
	} catch (e) {
		console.error(`[base-path] FAIL: ${e instanceof Error ? e.message : String(e)}`);
		process.exit(1);
	}
}
