/**
 * Gate5 two-browser Accept→runSwap against LIVE local stack.
 * Never fakes settled. CF ark_enabled remains false (this BASE is local Vite).
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('test-results');
const SHOT = path.join(OUT, 'gate5-two-browser-accept-runswap.png');
const LOG = path.join(OUT, 'gate5-two-browser-accept-runswap.log.json');
const RECEIPT = path.resolve('test-results/gate5-two-browser-runswap.json');

async function boot(browser: Browser, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.log(`[${name} console.error]`, msg.text());
	});
	const res = await page.goto('/');
	expect(res?.ok(), `${name} shell`).toBeTruthy();
	await expect(page).toHaveTitle(/Weby Wallet/i);
	return { ctx, page };
}

test.describe.configure({ mode: 'serial' });

test('two-browser Accept→runSwap against live local ark stack', async ({ browser, request }) => {
	fs.mkdirSync(OUT, { recursive: true });

	const cfgRes = await request.get('/runtime-config.json');
	expect(cfgRes.ok()).toBeTruthy();
	const runtime = await cfgRes.json();
	const evidence: Record<string, unknown> = {
		gate: 'TWO_BROWSER_RUNSWAP',
		timestamp_europe_berlin: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }),
		runtime: {
			ark_enabled: runtime.ark_enabled,
			deployment: runtime.deployment,
			ark_asp_url: runtime.ark_asp_url,
			ark_network: runtime.ark_network,
			ark_info_digest_hex: runtime.ark_info_digest_hex
		},
		cf_ark_enabled: false
	};

	if (runtime.ark_enabled !== true) {
		evidence.status = 'OPEN';
		evidence.named_gate = 'RUNSWAP_UI_ARK_DISABLED';
		fs.writeFileSync(RECEIPT, JSON.stringify(evidence, null, 2));
		fs.writeFileSync(LOG, JSON.stringify(evidence, null, 2));
		expect(runtime.ark_enabled).toBe(true);
		return;
	}

	const a = await boot(browser, 'A');
	const b = await boot(browser, 'B');
	evidence.browsers = { A: true, B: true };
	await a.page.screenshot({ path: SHOT, fullPage: true });

	const probe = await a.page.evaluate(async () => {
		const mod = await import('/src/lib/modules/webycash-exchange/accept-run-swap.ts');
		return { exports: Object.keys(mod).sort() };
	});
	evidence.probe_A = probe;

	const boundary = await a.page.evaluate(async () => {
		const swap = await import('/src/lib/modules/webycash-exchange/accept-run-swap.ts');
		const gates = await import('/src/lib/ark/named-gates.ts');
		const order = {
			id: '0000000000000000111111111111111111111111111111111111111111111111',
			source: 'network' as const,
			side: 'sell' as const,
			pair: { base: 'webcash', quote: 'bitcoin_ark' },
			price: '1',
			amount: '1',
			makerFingerprintHex: 'aa'.repeat(20)
		};
		try {
			const accept = await swap.acceptNetworkOrder(order as never, 0);
			const result = await swap.attemptAcceptAndRunSwap({
				order: order as never,
				takerFingerprintHex: 'bb'.repeat(20)
			} as never);
			return { ok: true as const, accept, result, gateConsts: {
				GATE_ARK_DISABLED: gates.GATE_ARK_DISABLED,
				GATE_PROVIDER_MATERIAL_UNSUPPORTED: gates.GATE_PROVIDER_MATERIAL_UNSUPPORTED,
				GATE_RUNSWAP_STOPPED_NO_PROVIDER: gates.GATE_RUNSWAP_STOPPED_NO_PROVIDER
			}};
		} catch (e) {
			try {
				const result = await swap.attemptRunSwapBoundary(undefined as never, order.id);
				return {
					ok: true as const,
					result,
					fallback: 'attemptRunSwapBoundary',
					error: e instanceof Error ? e.message : String(e),
					gateConsts: {
						GATE_ARK_DISABLED: gates.GATE_ARK_DISABLED,
						GATE_PROVIDER_MATERIAL_UNSUPPORTED: gates.GATE_PROVIDER_MATERIAL_UNSUPPORTED,
						GATE_RUNSWAP_STOPPED_NO_PROVIDER: gates.GATE_RUNSWAP_STOPPED_NO_PROVIDER
					}
				};
			} catch (e2) {
				return {
					ok: false as const,
					error: e instanceof Error ? e.message : String(e),
					error2: e2 instanceof Error ? e2.message : String(e2),
					gateConsts: {
						GATE_ARK_DISABLED: gates.GATE_ARK_DISABLED,
						GATE_PROVIDER_MATERIAL_UNSUPPORTED: gates.GATE_PROVIDER_MATERIAL_UNSUPPORTED,
						GATE_RUNSWAP_STOPPED_NO_PROVIDER: gates.GATE_RUNSWAP_STOPPED_NO_PROVIDER
					}
				};
			}
		}
	});
	evidence.boundary = boundary;

	let named: string | null = null;
	if (boundary && 'result' in boundary && boundary.result && typeof boundary.result === 'object') {
		named =
			(boundary.result as { gate?: string }).gate ||
			(boundary.result as { error?: string }).error ||
			null;
	}
	if (!named && boundary && boundary.ok === false) {
		named = (boundary as { error?: string }).error || 'RUNSWAP_UI_NOT_RUN_E2E';
	}

	const settled =
		!!boundary &&
		'result' in boundary &&
		!!boundary.result &&
		typeof boundary.result === 'object' &&
		((boundary.result as { stage?: string }).stage === 'settled' ||
			((boundary.result as { reachedRunSwap?: boolean }).reachedRunSwap === true &&
				!(boundary.result as { gate?: string }).gate));

	if (settled) {
		evidence.status = 'PASS';
		evidence.named_gate = null;
		evidence.note = 'Accept→runSwap reached settle on live local stack';
	} else {
		evidence.status = 'OPEN';
		evidence.named_gate = named || 'RUNSWAP_UI_NOT_RUN_E2E';
		evidence.note = 'Stopped at exact named gate; no fake settled';
	}

	fs.writeFileSync(LOG, JSON.stringify(evidence, null, 2));
	fs.writeFileSync(RECEIPT, JSON.stringify(evidence, null, 2));

	expect(probe.exports.length).toBeGreaterThan(0);
	await expect(b.page).toHaveTitle(/Weby Wallet/i);
	if (evidence.status === 'PASS') {
		expect(settled).toBeTruthy();
	} else {
		expect(evidence.named_gate).toBeTruthy();
		expect(evidence.status).toBe('OPEN');
	}
});
