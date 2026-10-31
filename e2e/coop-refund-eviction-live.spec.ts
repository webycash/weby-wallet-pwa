/**
 * DRY live proof (no funds): abort → coop-refund-v1 against the LIVE dev referee
 * after its container was evicted (idle destroy). Two real WASM nodes (dev
 * keyserver-anchored identities), real prepare at the referee, NO funding: the
 * refund sighash bundle is random bytes (dry mode), so nothing can broadcast.
 * Proves: sealed Refund session survives eviction (D1), coop yields a valid
 * 2-of-2 aggregate under Q, and a second coop is refused (single use).
 * Mnemonics come from E2E_MNEMONICS_FILE and are never printed.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import { schnorr } from '@noble/curves/secp256k1.js';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:5183').replace(/\/$/, '');
const OUT = process.env.E2E_EVIDENCE_DIR ?? 'test-results/coop-evict';
const WAIT_MS = Number(process.env.E2E_EVICT_WAIT_MS ?? 200_000);
const MN = JSON.parse(fs.readFileSync(process.env.E2E_MNEMONICS_FILE!, 'utf8'));
const log: unknown[] = [];
const note = (step: string, data: unknown = null) => {
	const e = { t: new Date().toISOString(), step, data };
	log.push(e);
	console.log('COOP', JSON.stringify(e));
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(`${OUT}/coop-evict.json`, JSON.stringify(log, null, 1));
};

async function onboard(browser: Browser, mnemonic: string): Promise<Page> {
	const context = await browser.newContext();
	await context.route(/https?:\/\/([a-z0-9-]+\.)*webcash\.org\//, (r) => r.abort());
	const page = await context.newPage();
	await page.goto(`${BASE}/`);
	const rc = await page.evaluate(async (b) => (await fetch(`${b}/runtime-config.json`)).json(), BASE);
	const okDev = rc.deployment === 'development' && rc.ark_network === 'signet';
	const okStagingDry = process.env.E2E_ALLOW_STAGING_DRY === '1' && rc.deployment === 'staging' && rc.ark_network === 'bitcoin';
	if (!okDev && !okStagingDry) throw new Error('refusing: not dev/signet (or explicit staging dry)');
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
	return page;
}

test('dry live: prepare → referee container eviction → coop-refund-v1 (single use)', async ({ browser }) => {
	test.setTimeout(WAIT_MS + 300_000);
	const A = await onboard(browser, MN.A); // provider
	const B = await onboard(browser, MN.B); // bearer seller

	const ident = (p: Page) =>
		p.evaluate(async () => {
			const { getExtroClient } = await import('/src/lib/extro/index.ts');
			const { getSelfIdentity } = await import('/src/lib/extro/self-identity.ts');
			const { loadArkOverview } = await import('/src/lib/ark/ark-view.ts');
			const id = await getSelfIdentity(getExtroClient(), 0);
			const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
			const ov = await loadArkOverview();
			return { fp: id.fingerprintHex.toLowerCase(), pgp: hex(id.verifyingKey), ark: ov.arkAddress };
		});
	const a = await ident(A);
	const b = await ident(B);
	note('identities', { providerFp: a.fp, sellerFp: b.fp });

	const orderIdHex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');

	// Provider: pre-funding offer (records own ProviderMaterial).
	const offer = await A.evaluate(
		async ({ orderIdHex, sellerFp, ark }) => {
			const { getExtroClient } = await import('/src/lib/extro/index.ts');
			const { newRequestId } = await import('/src/lib/extro/commands.ts');
			const { fetchSwapMsgs } = await import('/src/lib/modules/webycash-exchange/accept-run-swap.ts');
			const un = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16));
			const res: any = await getExtroClient().send({
				request_id: newRequestId(),
				op: { kind: 'Dhtx', cmd: { op: 'SendProviderOffer', slot: 0, order_id: un(orderIdHex), counterparty_fp: un(sellerFp), provider_ark_destination: ark } }
			});
			if (res.kind === 'Err') throw new Error(`SendProviderOffer: ${res.message}`);
			const p: any = (await fetchSwapMsgs(orderIdHex)).provider;
			if (!p) throw new Error('own offer not recorded');
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(p)) out[k] = v instanceof Uint8Array ? { $u8: Array.from(v) } : v;
			return out;
		},
		{ orderIdHex, sellerFp: b.fp, ark: a.ark }
	);
	note('offer', { locked_ref_prefix: String(offer.locked_ref).slice(0, 6) });

	// Seller: build + sign terms (prepare-only, 500 sat notional, no funding).
	const sellerSigned = await B.evaluate(
		async ({ offer, orderIdHex, me }) => {
			const ap = await import('/src/lib/modules/webycash-exchange/accept-prepare.ts');
			const sp = await import('/src/lib/modules/webycash-exchange/swap-prepare.ts');
			const un = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16));
			const prov: any = {};
			for (const [k, v] of Object.entries(offer as any)) prov[k] = v && typeof v === 'object' && '$u8' in (v as any) ? Uint8Array.from((v as any).$u8) : v;
			const orderId16 = un(orderIdHex);
			const commitment = new Uint8Array(await crypto.subtle.digest('SHA-256', orderId16));
			const terms = ap.buildArkPrepareTermsFromProvider({
				orderId16,
				signedOrderCommitmentSha256: commitment,
				fillAmountRaw: 1n,
				provider: prov,
				allowOffer: true,
				bearerSellerFpHex: me.fp,
				bearerSellerPgpPubkeyHex: me.pgp,
				bearerSellerCancelPubkeyHex: me.pgp,
				providerArkDestination: String(prov.locked_ref).slice('offer:'.length),
				bearerSellerArkDestination: me.ark,
				arkAmountSats: 500n,
				ttlSeconds: 500
			});
			const s = await sp.signSwapPrepare(terms, 0);
			return Array.from(s.signed);
		},
		{ offer, orderIdHex, me: b }
	);

	// Provider: inspect, countersign, submit dual-signed prepare to the live referee.
	const prep = await A.evaluate(
		async ({ sellerSigned }) => {
			const { getExtroClient } = await import('/src/lib/extro/index.ts');
			const { newRequestId } = await import('/src/lib/extro/commands.ts');
			const { getRuntimeConfig } = await import('/src/lib/extro/runtime-config.ts');
			const ap = await import('/src/lib/modules/webycash-exchange/accept-prepare.ts');
			const sp = await import('/src/lib/modules/webycash-exchange/swap-prepare.ts');
			const sc = await import('/src/lib/ark/swap-contract.ts');
			const { HttpRefereeClient } = await import('/src/lib/modules/webycash-exchange/referee-client.ts');
			const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
			const un = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16));
			const seller = Uint8Array.from(sellerSigned);
			const ins: any = await getExtroClient().send({ request_id: newRequestId(), op: { kind: 'Scheme402', cmd: { op: 'InspectSwapPrepare', counterparty_signed: seller } } });
			if (ins.kind === 'Err') throw new Error(`Inspect: ${ins.message}`);
			const terms = ins.body.terms;
			const cs = await sp.countersignSwapPrepare(seller, ap.expectationFromTerms(terms), 0);
			const cfg = getRuntimeConfig();
			const referee = new HttpRefereeClient({ baseUrl: cfg.referee_url, pinnedPubkeyHex: cfg.referee_vk_hex });
			const env = await sp.buildSwapPrepareEnvelope(cs.signed, seller);
			const v = await sp.submitAndVerifySwapPrepare({ referee, envelope: env, refereeVk: un(cfg.referee_vk_hex), expectedRequestCommitment: cs.requestCommitment, idempotencyKey: terms.idempotency_key });
			const plan = await sc.deriveVerifiedArkContractPlan({ terms, signedResponse: v.signedResponse, refereeVk: un(cfg.referee_vk_hex) });
			const w = window as any;
			w.__coop = { terms, plan, rc: hex(cs.requestCommitment) };
			return {
				swapId: v.swapId,
				requestCommitmentHex: hex(cs.requestCommitment),
				aggregateOwnerKeyHex: hex(plan.aggregateOwnerKey),
				refundNonceHexLen: String(v.refereeRefundNoncePub).length,
				dest: terms.provider_ark_destination,
				cancel: terms.parties.provider_cancel_pubkey_hex
			};
		},
		{ sellerSigned }
	);
	note('prepared', { swapId: prep.swapId, requestCommitment: prep.requestCommitmentHex, Q: prep.aggregateOwnerKeyHex });
	fs.writeFileSync(`${OUT}/swap-id.txt`, prep.swapId);

	// Idle so the referee container's onActivityExpired destroys it (eviction).
	note('evict-wait-start', { ms: WAIT_MS });
	await A.waitForTimeout(WAIT_MS);
	note('evict-wait-done');

	const coop = (attempt: string) =>
		A.evaluate(
			async ({ orderIdHex, prep, attempt }) => {
				const { getRuntimeConfig } = await import('/src/lib/extro/runtime-config.ts');
				const { coopRefundAggregate } = await import('/src/lib/ark/coop-refund.ts');
				const w = window as any;
				const n = Math.max(1, Math.round(prep.refundNonceHexLen / 132));
				const hash = crypto.getRandomValues(new Uint8Array(32 * n)); // DRY: random sighash, cannot broadcast
				const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
				try {
					const r = await coopRefundAggregate({
						refereeUrl: getRuntimeConfig().referee_url,
						swapId: prep.swapId,
						slot: 0,
						orderIdHex,
						requestCommitmentHex: prep.requestCommitmentHex,
						refundHashHex: hex(hash),
						aggregateOwnerKey: w.__coop.plan.aggregateOwnerKey,
						expectAmountSats: 500n,
						expectDestination: prep.dest,
						expectCancelPubkeyHex: prep.cancel
					});
					return { attempt, ok: true, phase: r.phase, n, sigsHex: r.signaturesHex, hashHex: hex(hash), q: hex(w.__coop.plan.aggregateOwnerKey) };
				} catch (e) {
					return { attempt, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 400) };
				}
			},
			{ orderIdHex, prep, attempt }
		);

	const first: any = await coop('first');
	expect(first.ok, JSON.stringify(first)).toBe(true);
	const sigs: string[] = first.sigsHex.match(/.{128}/g) ?? [];
	const hashes: string[] = first.hashHex.match(/.{64}/g) ?? [];
	note('coop-first-raw', { phase: first.phase, n: first.n, sigsHex: first.sigsHex });
	const valid = sigs.length === first.n && sigs.every((s, i) => schnorr.verify(Buffer.from(s, 'hex'), Buffer.from(hashes[i], 'hex'), Buffer.from(first.q, 'hex')));
	note('coop-first', { phase: first.phase, n: first.n, sigs: sigs.length, bip340ValidUnderQ: valid, q: first.q });
	expect(valid).toBe(true);
	const second = await coop('replay');
	note('coop-replay', second);
	expect(second.ok, 'second coop-refund must be refused (single-use Refund session)').toBe(false);
});
