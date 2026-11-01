// The OG card's spent read runs the release extro-node WASM (ephemeral boot)
// against a local webcash rail, so the real op, wire and status mapping are
// exercised end to end.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadExtroNodeWasm } from '@extro/node';
// @ts-expect-error — plain-JS worker module
import { createSpentChecker } from './webcash-status.js';

const wasmBytes = readFileSync(
	createRequire(import.meta.url).resolve('@extro/node/wasm/extro_node_bg.wasm')
);

// Public placeholder trust values only (mirrors @extro/node's test fixture).
const development = () => ({
	schema_version: 2,
	deployment: 'development',
	db_name: 'extro-node-og-test',
	adapter_mode: 'bundled',
	keyserver_url: 'https://dev.extro.network',
	keyserver_domain: 'dev.extro.network',
	keyserver_fingerprint_hex: '11'.repeat(20),
	keyserver_vk_hex: '22'.repeat(32),
	referee_url: 'https://dev.weby.cash/api/referee',
	referee_vk_hex: '33'.repeat(32),
	webcash_server_url: 'https://dev.weby.cash/api/webcash',
	voucher_server_url: 'https://dev.weby.cash/api/voucher',
	rgb_server_url: 'https://dev.weby.cash/api/rgb',
	rgb_collectible_server_url: 'https://dev.weby.cash/api/rgb-collectible',
	ark_enabled: false,
	ark_network: 'signet',
	ark_asp_url: '',
	ark_signer_pk_hex: '',
	ark_info_digest_hex: '',
	ark_checkpoint_tapscript_hex: '',
	ark_unilateral_exit_delay: 0,
	zkp_profile: 'development-only',
	zkp_bearer_vk_sha256: 'ecd299b3326e682106a31a39decf1fb43c0d5b960eb40baa2975691f406f77c1',
	zkp_conditional_vk_sha256: '8efdd75f738658f3da0308fac3cbf6912c1324e815d863548c7e82ba39d07f1d',
	ice_servers: ['stun:stun.cloudflare.com:3478'],
	turn_servers: [
		{ url: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
	],
	wallet_home_origin: 'https://wallet.test',
	connected_apps: [],
	grant_ttl_secs: 3600
});

const pub = (c: string) => `e1:public:${c.repeat(64)}`;
const SPENT = pub('a');
const UNSPENT = pub('b');
const UNKNOWN = pub('c');
const BROKEN = pub('d'); // rail answers 500
const SLOW = pub('e'); // rail never answers in time

let server: Server;
let base = '';
const seen: { path: string; contentType: string; body: string }[] = [];

beforeAll(async () => {
	server = createServer((req: IncomingMessage, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen.push({ path: req.url ?? '', contentType: String(req.headers['content-type'] ?? ''), body });
			const [token] = JSON.parse(body) as string[];
			if (token === BROKEN) return res.writeHead(500).end('boom');
			if (token === SLOW) return setTimeout(() => res.writeHead(200).end('{}'), 2000);
			const spent = token === SPENT ? true : token === UNSPENT ? false : null;
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ status: 'success', results: { [token]: { spent, amount: spent === null ? null : '1' } } }));
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const checker = (over: Record<string, unknown> = {}) =>
	createSpentChecker({
		load: () => loadExtroNodeWasm(wasmBytes),
		loadConfig: async () => development(),
		servers: { production: `${base}/main`, testnet: `${base}/test` },
		...over
	});

describe('OG spent check via extro-node Rail(WebcashTokenStatus)', () => {
	it('maps the rail tri-state and picks the server by network', async () => {
		const checkSpent = checker();
		expect(await checkSpent('production', SPENT)).toBe(true);
		expect(await checkSpent('testnet', UNSPENT)).toBe(false);
		expect(await checkSpent('production', UNKNOWN)).toBeNull();
		const paths = seen.map((s) => s.path);
		expect(paths).toContain('/main/api/v1/health_check');
		expect(paths).toContain('/test/api/v1/health_check');
	});

	it('speaks the webylib wire (CORS-simple, never a JSON content-type)', () => {
		expect(seen.length).toBeGreaterThan(0);
		for (const s of seen) {
			expect(s.contentType).not.toMatch(/application\/json/i);
			expect(JSON.parse(s.body)).toHaveLength(1);
		}
	});

	it('fails soft: rail error, timeout, malformed token, bad config', async () => {
		const checkSpent = checker({ timeoutMs: 300 });
		expect(await checkSpent('production', BROKEN)).toBeNull();
		expect(await checkSpent('production', SLOW)).toBeNull();
		expect(await checkSpent('production', 'not-a-token')).toBeNull();
		expect(await checkSpent('production', '')).toBeNull();
		const bad = checker({ loadConfig: async () => ({ schema_version: 1 }) });
		expect(await bad('production', SPENT)).toBeNull();
	});
});
