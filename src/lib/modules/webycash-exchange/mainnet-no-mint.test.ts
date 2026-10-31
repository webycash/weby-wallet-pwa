/**
 * Mainnet-mode guard: the product swap paths (taker builder + role protocol
 * bearer side) must never mint, mine or replace webcash. Any such attempt —
 * via the extro client (MintWebcash / mining ops) or via HTTP to the rail
 * (/api/v1/replace, mining_report, target) — fails this test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAINNET = vi.hoisted(() => ({
	ark_enabled: true,
	ark_network: 'bitcoin',
	ark_signer_pk_hex: '44'.repeat(32),
	ark_info_digest_hex: '55'.repeat(32),
	ark_unilateral_exit_delay: 605184,
	ark_asp_url: 'https://arkade.computer',
	referee_url: 'https://dev.weby.cash/api/referee',
	referee_vk_hex: '66'.repeat(32),
	webcash_server_url: 'https://webcash.org',
	deployment: 'staging'
}));
const forbidden = vi.hoisted(() => ({ attempts: [] as string[] }));
const FORBIDDEN_OPS = /^(MintWebcash|Mine|StartMining|MiningReport|SubmitMiningReport|ReplaceWebcash|Replace)$/;
const FORBIDDEN_URL = /\/api\/v1\/(replace|mining_report|target)\b/;

vi.mock('$lib/extro/runtime-config', () => ({ getRuntimeConfig: () => MAINNET }));
vi.mock('$lib/extro', () => ({
	getExtroClient: () => ({
		send: async (req: { op: { cmd: { op: string } } }) => {
			const op = req?.op?.cmd?.op ?? String(req);
			if (FORBIDDEN_OPS.test(op)) forbidden.attempts.push(`extro:${op}`);
			throw new Error(`unexpected extro op in mainnet-mode test: ${op}`);
		}
	})
}));
vi.mock('./swap-facts', () => ({
	bearerLegFromWallet: async (_s: number, _i: number, fill: bigint) => ({
		publicTokenHash: Uint8Array.from({ length: 32 }, () => 0xe1),
		bearerAmount: (Number(fill) / 1e8).toString(),
		fillAmountRaw: fill
	})
}));

import { buildProductRunSwapInput } from './build-product-run-swap-input';

const order = {
	id: '0f'.repeat(16),
	pair: { base: 'Webcash', quote: 'BitcoinArk' },
	side: 'buy',
	price: 10,
	amount: 100,
	makerFingerprint: 'cd'.repeat(20),
	makerVk: '77'.repeat(32),
	expiresAt: Math.floor(Date.now() / 1000) + 3600,
	observedAt: 0,
	source: 'dht',
	signedCommitment: ''
} as never;
const material = (locked_ref: string) =>
	({ locked_ref, provider_musig2_pubkey: '02'.padEnd(66, '1') }) as never;

let railRow: unknown;
beforeEach(() => {
	forbidden.attempts = [];
	railRow = { spent: null, amount: null };
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (FORBIDDEN_URL.test(url)) {
			forbidden.attempts.push(`http:${url}`);
			throw new Error('forbidden rail write in mainnet mode');
		}
		if (url === 'https://webcash.org/api/v1/health_check') {
			const [token] = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ status: 'success', results: { [token]: railRow } }));
		}
		throw new Error(`unexpected fetch ${url}`);
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	expect(forbidden.attempts).toEqual([]);
});

describe('mainnet mode: taker product path never mints, mines or replaces', () => {
	it('an unissued bearer H (spent:null) is a named gate — not minted into existence', async () => {
		await expect(buildProductRunSwapInput(material(`${'33'.repeat(32)}:0`), order)).rejects.toThrow(/^BEARER_LEG_NOT_ISSUED/);
	});
	it('a spent bearer H is a named gate', async () => {
		railRow = { spent: true, amount: '100' };
		await expect(buildProductRunSwapInput(material(`${'33'.repeat(32)}:0`), order)).rejects.toThrow(/^BEARER_LEG_UNUSABLE/);
	});
	it('with a live H, a provider that funded before the referee pre-check is refused', async () => {
		railRow = { spent: false, amount: '100' };
		await expect(buildProductRunSwapInput(material(`${'33'.repeat(32)}:0`), order)).rejects.toThrow(/^REFEREE_PRECHECK_PENDING.*before the referee pre-check/);
	});
});

describe('static guard: no mint/mine/replace in the product swap path', () => {
	const root = join(process.cwd(), 'src/lib/modules/webycash-exchange');
	const files = readdirSync(root)
		.map((f) => join(root, f))
		.filter((f) => statSync(f).isFile() && /\.(ts|svelte)$/.test(f) && !/\.test\.ts$/.test(f));
	it.each(files)('%s', (f) => {
		const src = readFileSync(f, 'utf8');
		expect(src).not.toMatch(/MintWebcash|mintBearerWebcash|\/api\/v1\/replace|mining_report|25_000n/);
	});
});
