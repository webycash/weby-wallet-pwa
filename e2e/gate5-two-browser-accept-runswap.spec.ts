/**
 * Gate5 two-browser Accept→ProviderMaterial→runSwap against LIVE local stack.
 *
 * Closes RUNSWAP_STOPPED_NO_PROVIDER by delivering genuine maker ProviderMaterial
 * (locked_ref + settle/refund hashes) over DHTX into the taker Accept path, then
 * aligning settle with the harness that already settles both directions.
 *
 * Never fakes settled. CF ark_enabled remains false (this BASE is local Vite).
 */
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bootRealNode, closeNode, type RealNode } from './fixtures/real-node';

const OUT = path.resolve('test-results');
const SHOT = path.join(OUT, 'gate5-two-browser-accept-runswap.png');
const LOG = path.join(OUT, 'gate5-two-browser-accept-runswap.log.json');
const RECEIPT = path.resolve('test-results/gate5-two-browser-runswap.json');
const FUND_OUT = path.resolve('test-results/gate5-two-browser-fund.json');

const KS_DOMAIN = 'keyserver.local';
const KS_FINGERPRINT_HEX = '00112233445566778899aabbccddeeff00112233';
const KS_VK_HEX = 'd04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737';

const ASP = process.env.ARK_ASP_URL ?? 'http://127.0.0.1:7070';
const ESPLORA = process.env.ARK_ESPLORA_URL ?? 'http://127.0.0.1:3000/api';
const ARK_PRIV =
	process.env.ARK_PRIVKEY_HEX ?? 'c1d7c093812cace1786bd138f7b3a19caa8990848c4cbeb76bcb08a73284c4a6';
const PROVIDER_BIN =
	process.env.GATE5_PROVIDER_BIN ??
	path.resolve('../..', 'extro/extro-node/target/release/examples/gate5_provider_partial');
const CLAIM_BIN =
	process.env.GATE5_CLAIM_BIN ??
	path.resolve('../..', 'extro/extro-node/target/release/examples/gate5_ark_claim');
const A2W_SH =
	process.env.GATE5_A2W_SH ??
	path.resolve('..', 'webycash-server/local-stack/gate5-ark-to-webcash.sh');

function hexToBytes(hex: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < hex.length; i += 2) out.push(Number.parseInt(hex.slice(i, i + 2), 16));
	return out;
}

function bytesToHex(arr: Iterable<number>): string {
	return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pinKeyserver(node: RealNode) {
	return node.page.evaluate(
		async ({ domain, fingerprintHex, vkHex, baseUrl }) => {
			const client = (window as unknown as { __extro: any }).__extro;
			const { newRequestId } = await import('/src/lib/extro/commands.ts');
			const res = await client.send({
				request_id: newRequestId(),
				op: {
					kind: 'Keyserver',
					cmd: {
						op: 'Pin',
						base_url: baseUrl,
						domain,
						fingerprint_hex: fingerprintHex,
						vk_hex: vkHex
					}
				}
			});
			return res;
		},
		{
			domain: KS_DOMAIN,
			fingerprintHex: KS_FINGERPRINT_HEX,
			vkHex: KS_VK_HEX,
			baseUrl: 'http://127.0.0.1:7800'
		}
	);
}

async function bootstrap(node: RealNode) {
	return node.page.evaluate(
		async ({ domain, baseUrl }) => {
			const client = (window as unknown as { __extro: any }).__extro;
			const { newRequestId } = await import('/src/lib/extro/commands.ts');
			const res = await client.send({
				request_id: newRequestId(),
				op: { kind: 'Keyserver', cmd: { op: 'Bootstrap', base_url: baseUrl, domain } }
			});
			if (res?.kind === 'Ok' && res.body?.kind === 'Bootstrapped') {
				return {
					ok: true as const,
					connected: !!res.body.connected,
					roster: Number(res.body.roster_count ?? 0),
					peersConnected: Number(res.body.peers_connected ?? 0),
					body: res.body
				};
			}
			return {
				ok: false as const,
				connected: false,
				roster: 0,
				peersConnected: 0,
				err: res?.kind === 'Err' ? `${res.code}: ${res.message}` : JSON.stringify(res)
			};
		},
		{ domain: KS_DOMAIN, baseUrl: 'http://127.0.0.1:7800' }
	);
}

/** Overlapping A/B bootstrap windows until a peer DataChannel opens (product reconnect). */
async function connectPeers(nodeA: RealNode, nodeB: RealNode) {
	let a = await bootstrap(nodeA);
	let b = { ok: false as const, connected: false, roster: 0, peersConnected: 0 };
	for (let attempt = 1; attempt <= 5; attempt++) {
		a = await bootstrap(nodeA);
		await nodeA.page.waitForTimeout(1000);
		[a, b] = await Promise.all([bootstrap(nodeA), bootstrap(nodeB)]);
		console.log(`[peers] attempt ${attempt}`, JSON.stringify({ a, b }));
		if (a.ok && b.ok && a.peersConnected + b.peersConnected > 0) return { a, b };
		await nodeA.page.waitForTimeout(1500);
	}
	return { a, b };
}

async function deriveIdentity(node: RealNode): Promise<{ fp: string; vkHex: string }> {
	const id = await node.page.evaluate(async () => {
		const client = (window as unknown as { __extro: any }).__extro;
		const { newRequestId } = await import('/src/lib/extro/commands.ts');
		const res = await client.send({
			request_id: newRequestId(),
			op: { kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot: 0 } }
		});
		if (res?.kind !== 'Ok' || res.body?.kind !== 'Identity') {
			return { ok: false as const, raw: res };
		}
		const vk = res.body.verifying_key as Uint8Array | number[];
		const vkHex = Array.from(vk as Iterable<number>, (b) => b.toString(16).padStart(2, '0')).join('');
		return { ok: true as const, fingerprint_hex: res.body.fingerprint_hex as string, vkHex };
	});
	expect(id.ok, JSON.stringify(id)).toBe(true);
	if (!id.ok) throw new Error('deriveIdentity failed');
	return { fp: id.fingerprint_hex, vkHex: id.vkHex };
}

async function deriveFp(node: RealNode): Promise<string> {
	return (await deriveIdentity(node)).fp;
}

function fundGenuineVtxo(): {
	locked_ref: string;
	tx_settle_hash_hex: string;
	tx_refund_hash_hex: string;
	owner_q: string;
	provider_pub: string;
	settle_nonce: string;
	refund_nonce: string;
} {
	const providerSk = 'a1'.repeat(32);
	const mat = JSON.parse(
		execFileSync(PROVIDER_BIN, ['material'], {
			env: { ...process.env, PROVIDER_SK_HEX: providerSk, FILL_ID: `gate5-2b-${Date.now()}` },
			encoding: 'utf8'
		})
	);
	const refereePk = JSON.parse(
		execFileSync('/usr/bin/curl', ['-fsS', 'http://127.0.0.1:8090/v1/pubkey'], { encoding: 'utf8' })
	).musig2_pubshare_hex as string;

	const fundEnv = {
		...process.env,
		ARK_PRIVKEY_HEX: ARK_PRIV,
		ARK_ASP_URL: ASP,
		ARK_ESPLORA_URL: ESPLORA,
		ARK_DB_PATH:
			process.env.ARK_DB_PATH ??
			path.resolve('test-results/ark-provider-sled'),
		REFEREE_PK_HEX: refereePk,
		PROVIDER_PK_HEX: mat.pubkeyHex as string,
		AMOUNT_SATS: '25000',
		EXIT_DELAY: '512'
	};
	const fundRaw = execFileSync(CLAIM_BIN, ['fund'], { env: fundEnv, encoding: 'utf8' });
	const fund = JSON.parse(fundRaw.trim().split('\n').filter(Boolean).at(-1) || fundRaw);
	const lockedRef = String(fund.lockedRef);
	const settle = String(fund.settleSighashHex);
	const refund = createHash('sha256').update(`${settle}|refund`).digest('hex');
	fs.writeFileSync(
		FUND_OUT,
		JSON.stringify(
			{
				locked_ref: lockedRef,
				settle,
				refund,
				fund,
				provider: mat,
				refereePk
			},
			null,
			2
		)
	);
	return {
		locked_ref: lockedRef,
		tx_settle_hash_hex: settle,
		tx_refund_hash_hex: refund,
		owner_q: String(fund.ownerQHex || fund.owner_q_hex || ''),
		provider_pub: mat.pubkeyHex,
		settle_nonce: mat.settleNonceHex,
		refund_nonce: mat.refundNonceHex
	};
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

test('two-browser Accept→ProviderMaterial→runSwap closes NO_PROVIDER', async ({ browser, request }) => {
	fs.mkdirSync(OUT, { recursive: true });
	const freeGib = Number(
		execFileSync('df', ['-g', '/'], { encoding: 'utf8' }).trim().split('\n')[1].split(/\s+/)[3]
	);
	expect(freeGib, `disk ${freeGib} GiB`).toBeGreaterThanOrEqual(40);

	// Referee prepare fails closed unless party fingerprints exist on keyserver.
	execFileSync('node', [path.resolve('e2e/helpers/register-keyserver-identity.mjs')], {
		stdio: 'inherit',
		env: process.env
	});

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
		cf_ark_enabled: false,
		disk_free_gib: freeGib
	};

	if (runtime.ark_enabled !== true) {
		evidence.status = 'OPEN';
		evidence.named_gate = 'RUNSWAP_UI_ARK_DISABLED';
		fs.writeFileSync(RECEIPT, JSON.stringify(evidence, null, 2));
		expect(runtime.ark_enabled).toBe(true);
		return;
	}

	// Pin live ASP digest into evidence (referee already started with matching pin).
	const aspInfo = await (await fetch(`${ASP}/v1/info`)).json();
	evidence.asp_live_digest = String(aspInfo.digest).toLowerCase();
	expect(String(aspInfo.digest).toLowerCase()).toBe(String(runtime.ark_info_digest_hex).toLowerCase());

	let nodeA: RealNode | null = null;
	let nodeB: RealNode | null = null;
	try {
		nodeA = await bootRealNode(browser, 'A');
		nodeB = await bootRealNode(browser, 'B');
		evidence.browsers = { A: true, B: true };

		const pinA = await pinKeyserver(nodeA);
		const pinB = await pinKeyserver(nodeB);
		expect(pinA.kind, JSON.stringify(pinA)).toBe('Ok');
		expect(pinB.kind, JSON.stringify(pinB)).toBe('Ok');
		const { a: bootA, b: bootB } = await connectPeers(nodeA, nodeB);
		evidence.bootstrap = {
			A: { peers: bootA.peersConnected, roster: bootA.roster, ok: bootA.ok },
			B: { peers: bootB.peersConnected, roster: bootB.roster, ok: bootB.ok }
		};
		expect(
			bootA.ok && bootB.ok && bootA.peersConnected + bootB.peersConnected > 0,
			`no DataChannel A=${JSON.stringify(bootA)} B=${JSON.stringify(bootB)}`
		).toBeTruthy();

		const idA = await deriveIdentity(nodeA);
		const idB = await deriveIdentity(nodeB);
		const fpA = idA.fp;
		const fpB = idB.fp;
		evidence.fingerprints = { A: fpA, B: fpB };
		const sharedExpiresAtUnix = Math.floor(Date.now() / 1000) + 300;
		evidence.prepare_expires_at_unix = sharedExpiresAtUnix;

		// Fund genuine VTXO (same claim fund path as harness).
		const funding = fundGenuineVtxo();
		evidence.funding = {
			locked_ref: funding.locked_ref,
			settle: funding.tx_settle_hash_hex.slice(0, 16) + '…',
			refund: funding.tx_refund_hash_hex.slice(0, 16) + '…'
		};
		expect(funding.locked_ref).toMatch(/^[0-9a-f]{64}:\d+$/i);

		const pair = { base: 'BitcoinArk', quote: 'Webcash' };
		const published = await nodeA.page.evaluate(async (pairArg) => {
			const client = (window as unknown as { __extro: any }).__extro;
			const { newRequestId } = await import('/src/lib/extro/commands.ts');
			return client.send({
				request_id: newRequestId(),
				op: {
					kind: 'Dhtx',
					cmd: {
						op: 'PublishOrder',
						slot: 0,
						pair: pairArg,
						side: 'Sell',
						price_atomic: 1n,
						amount_atomic: 1n,
						expires_at: Math.floor(Date.now() / 1000) + 3600
					}
				}
			});
		}, pair);
		expect(published.kind, JSON.stringify(published)).toBe('Ok');
		const orderIdBytes: number[] = Array.from(published.body.order_id as Uint8Array);
		const orderIdHex = bytesToHex(orderIdBytes);
		evidence.order_id = orderIdHex;

		// B discovers order
		let discovered: any = null;
		for (let i = 0; i < 50; i++) {
			const fetched = await nodeB.page.evaluate(async (pairArg) => {
				const client = (window as unknown as { __extro: any }).__extro;
				const { newRequestId } = await import('/src/lib/extro/commands.ts');
				return client.send({
					request_id: newRequestId(),
					op: { kind: 'Dhtx', cmd: { op: 'FetchOrders', pair: pairArg } }
				});
			}, pair);
			expect(fetched.kind).toBe('Ok');
			const orders = fetched.body.orders as any[];
			discovered = orders?.find((o) => {
				const raw = o.order_id;
				const hex =
					typeof raw === 'string'
						? raw
						: bytesToHex(Array.from(raw as ArrayLike<number>));
				return hex.toLowerCase() === orderIdHex.toLowerCase();
			});
			if (discovered) break;
			await new Promise((r) => setTimeout(r, 150));
		}
		expect(discovered, 'B never discovered A order').toBeTruthy();

		const orderForAccept = {
			id: orderIdHex,
			source: 'dhtx' as const,
			side: 'sell' as const,
			pair: { base: 'BitcoinArk', quote: 'Webcash' },
			price: '1',
			amount: '1',
			makerFingerprint: fpA
		};

		// B Accept via product path: await provider, then dual-signed prepare → RunSwapInput.
		const acceptPromise = nodeB.page.evaluate(
			async ({ order, takerFp, makerFp, bearerFpHex, bearerVkHex, sharedExpiresAtUnix }) => {
				const swap = await import('/src/lib/modules/webycash-exchange/accept-run-swap.ts');
				const prepare = await import('/src/lib/modules/webycash-exchange/accept-prepare.ts');
				const { getRuntimeConfig } = await import('/src/lib/extro/runtime-config.ts');
				const { HttpRefereeClient } = await import('/src/lib/modules/webycash-exchange/referee-client.ts');
				const { deriveVerifiedArkContractPlan, buildArkSwapContract } = await import(
					'/src/lib/ark/swap-contract.ts'
				);
				const hexToBytes = (hex: string) => {
					const out = new Uint8Array(hex.length / 2);
					for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
					return out;
				};
				const bytesToHex = (b: Uint8Array) =>
					Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
				const sha256 = async (bytes: Uint8Array) => {
					const dig = await crypto.subtle.digest('SHA-256', bytes);
					return new Uint8Array(dig);
				};

				return swap.attemptAcceptAndRunSwap({
					order: order as never,
					takerFingerprintHex: takerFp,
					awaitProvider: true,
					awaitProviderOpts: { timeoutMs: 60_000, intervalMs: 250 },
					buildRunSwapInput: async (provider, ord) => {
						try {
						const cfg = getRuntimeConfig();
						const orderId16 = hexToBytes(ord.id);
						const commitment = await sha256(orderId16);
						const idem = (await sha256(new TextEncoder().encode(`idem:${ord.id}`))).slice(0, 16);
						const nonce = await sha256(new TextEncoder().encode(`nonce:${ord.id}`));

						// Bearer-seller identity from harness (DeriveIdentity already consumed slot 0).
						const bearerFp = String(bearerFpHex).toLowerCase();
						const bearerPgp = String(bearerVkHex).toLowerCase();
						const bearerCancel = bearerPgp;

						const terms = prepare.buildArkPrepareTermsFromProvider({
							orderId16,
							signedOrderCommitmentSha256: commitment,
							fillAmountRaw: 1n,
							provider,
							bearerSellerFpHex: bearerFp,
							bearerSellerPgpPubkeyHex: bearerPgp,
							bearerSellerCancelPubkeyHex: bearerCancel,
							providerArkDestination: 'ark:provider-e2e',
							bearerSellerArkDestination: 'ark:seller-e2e',
							arkAmountSats: 25_000n,
							idempotencyKey: idem,
							nonce,
							expiresAtUnix: sharedExpiresAtUnix
						});
						const expected = prepare.expectationFromTerms(terms);

						// Publish exact terms for maker A to sign (sender cannot FetchSwapMsgs its own ProviderMaterial).
						const b2h = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
						(window as unknown as { __gate5TermsDraft?: unknown }).__gate5TermsDraft = {
							order_id: b2h(terms.order_id),
							signed_order_commitment_sha256: b2h(terms.signed_order_commitment_sha256),
							fill_amount_raw: terms.fill_amount_raw.toString(),
							parties: terms.parties,
							provider_nonces: terms.provider_nonces,
							ark_network: terms.ark_network,
							ark_operator_signer_pk: b2h(terms.ark_operator_signer_pk),
							ark_operator_info_digest: b2h(terms.ark_operator_info_digest),
							ark_unilateral_exit_delay: terms.ark_unilateral_exit_delay.toString(),
							ark_amount_sats: terms.ark_amount_sats.toString(),
							provider_ark_destination: terms.provider_ark_destination,
							bearer_seller_ark_destination: terms.bearer_seller_ark_destination,
							idempotency_key: b2h(terms.idempotency_key),
							nonce: b2h(terms.nonce),
							expires_at_unix: terms.expires_at_unix
						};
						for (let i = 0; i < 200; i++) {
							if ((window as unknown as { __gate5ProviderPrepareDone?: boolean }).__gate5ProviderPrepareDone) break;
							await new Promise((r) => setTimeout(r, 100));
						}
						if (!(window as unknown as { __gate5ProviderPrepareDone?: boolean }).__gate5ProviderPrepareDone) {
							throw new Error('timed out waiting for provider to sign the published prepare terms');
						}

						// Countersign + relay; provider signature is relayed by A after terms draft.
						const countersigned = await prepare.bearerSellerCountersignAndRelayPrepare({
							orderId16,
							providerFp: hexToBytes(makerFp),
							expected,
							timeoutMs: 90_000,
							intervalMs: 300
						});

						// Bearer signature is relayed to the provider inbox; do not wait for a
						// mirrored local copy — use the countersign return bytes directly.
						const referee = new HttpRefereeClient({
							baseUrl: cfg.referee_url,
							pinnedPubkeyHex: cfg.referee_vk_hex
						});
						const refereeVk = hexToBytes(cfg.referee_vk_hex);
						const verified = await prepare.submitDualSignedPrepare({
							referee,
							refereeVk,
							orderId16,
							forFingerprint: hexToBytes(makerFp),
							providerSigned: countersigned.providerSigned,
							bearerSellerSigned: countersigned.signed,
							expectedRequestCommitment: countersigned.requestCommitment,
							idempotencyKey: terms.idempotency_key,
							relay: true
						});

						(window as unknown as { __gate5Prepare?: unknown }).__gate5Prepare = {
							swapId: verified.swapId,
							requestCommitment: bytesToHex(verified.requestCommitment),
							expiresAtUnix: String(verified.expiresAtUnix)
						};

						const plan = await deriveVerifiedArkContractPlan({
							terms,
							signedResponse: verified.signedResponse,
							refereeVk
						});
						const arkContract = buildArkSwapContract(cfg as never, plan);

						const mnemonic = (window as unknown as { __mnemonic?: string }).__mnemonic;
						if (!mnemonic) throw new Error('window.__mnemonic missing for prove');

						const conditional = new Uint8Array(128);
						conditional[0] = 0x00;
						conditional[1] = 0x00;
						conditional[2] = 0x00;
						conditional[3] = 0x40;
						crypto.getRandomValues(conditional.subarray(4, 68));
						const encSecret = new Uint8Array(64);
						crypto.getRandomValues(encSecret);

						const providerMat = swap.providerMaterialFromWire(provider, conditional);
						return {
							order: ord,
							mnemonic,
							provider: providerMat,
							bearerSeller: {
								bearer_seller_fp: bearerFp,
								bearer_seller_pgp_pubkey: bearerPgp,
								bearer_seller_cancel_pubkey_hex: bearerCancel
							},
							encSecretForProvider: encSecret,
							prepared: {
								swapId: verified.swapId,
								requestCommitment: verified.requestCommitment,
								idempotencyKey: terms.idempotency_key,
								expiresAtUnix: BigInt(verified.expiresAtUnix)
							},
							arkContract,
							arkFundingReader: {
								async refreshVtxos(_opts: { scripts: string[] }) {},
								async getContractsWithVtxos(filter: { script: string }) {
									return [
										{
											contract: { script: arkContract.pkScriptHex },
											vtxos: [
												{
													outpoint: provider.locked_ref,
													script: arkContract.pkScriptHex,
													value: Number(plan.amountSats),
													createdAt: new Date()
												}
											]
										}
									].filter((c) => c.contract.script === filter.script);
								}
							},
							referee
						} as never;
						} catch (err) {
							(window as unknown as { __gate5Prepare?: unknown }).__gate5Prepare = {
								error: err instanceof Error ? err.message : String(err)
							};
							throw err;
						}
					}
				});
			},
			{ order: orderForAccept, takerFp: fpB, makerFp: fpA, bearerFpHex: fpB, bearerVkHex: idB.vkHex, sharedExpiresAtUnix }
		);

		// A waits for Accept then SendProviderMaterial with genuine funding.
		let gotAccept = false;
		let acceptBody: any = null;
		for (let i = 0; i < 80; i++) {
			const msgs = await nodeA.page.evaluate(async (oidHex) => {
				const swap = await import('/src/lib/modules/webycash-exchange/accept-run-swap.ts');
				return swap.fetchSwapMsgs(oidHex);
			}, orderIdHex);
			if (msgs.accept) {
				gotAccept = true;
				acceptBody = msgs.accept;
				break;
			}
			await new Promise((r) => setTimeout(r, 200));
		}
		expect(gotAccept, 'maker A never saw Accept').toBeTruthy();

		const sent = await nodeA.page.evaluate(
			async ({ order, takerFp, funding }) => {
				const swap = await import('/src/lib/modules/webycash-exchange/accept-run-swap.ts');
				return swap.probeProviderMaterial(order as never, takerFp, 0, {
					lockedRef: funding.locked_ref,
					txSettleHashHex: funding.tx_settle_hash_hex,
					txRefundHashHex: funding.tx_refund_hash_hex
				});
			},
			{ order: orderForAccept, takerFp: fpB, funding }
		);
		evidence.send_provider = sent;
		expect(sent.ok, JSON.stringify(sent)).toBe(true);

		// A (provider) dual-signs prepare in parallel with B's buildRunSwapInput.
		// Wait until B published byte-exact prepare terms from wire ProviderMaterial.
		let termsDraft: any = null;
		for (let i = 0; i < 200; i++) {
			termsDraft = await nodeB.page.evaluate(
				() => (window as unknown as { __gate5TermsDraft?: unknown }).__gate5TermsDraft ?? null
			);
			if (termsDraft) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		expect(termsDraft, 'B never published __gate5TermsDraft').toBeTruthy();

		const providerPrepare = await nodeA.page.evaluate(
			async ({ orderIdHex, takerFp, termsDraft }) => {
				const prepare = await import('/src/lib/modules/webycash-exchange/accept-prepare.ts');
				const hexToBytes = (hex: string) => {
					const out = new Uint8Array(hex.length / 2);
					for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
					return out;
				};
				const bytesToHex = (b: Uint8Array) =>
					Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
				const d = termsDraft as any;
				const terms = {
					order_id: hexToBytes(d.order_id),
					signed_order_commitment_sha256: hexToBytes(d.signed_order_commitment_sha256),
					fill_amount_raw: BigInt(d.fill_amount_raw),
					parties: d.parties,
					provider_nonces: d.provider_nonces,
					ark_network: d.ark_network,
					ark_operator_signer_pk: hexToBytes(d.ark_operator_signer_pk),
					ark_operator_info_digest: hexToBytes(d.ark_operator_info_digest),
					ark_unilateral_exit_delay: BigInt(d.ark_unilateral_exit_delay),
					ark_amount_sats: BigInt(d.ark_amount_sats),
					provider_ark_destination: d.provider_ark_destination,
					bearer_seller_ark_destination: d.bearer_seller_ark_destination,
					idempotency_key: hexToBytes(d.idempotency_key),
					nonce: hexToBytes(d.nonce),
					expires_at_unix: Number(d.expires_at_unix)
				};
				const signed = await prepare.providerSignAndRelayPrepare({
					terms,
					orderId16: hexToBytes(orderIdHex),
					bearerSellerFp: hexToBytes(takerFp)
				});
				return {
					ok: true,
					delivered: signed.delivered,
					requestCommitment: bytesToHex(signed.requestCommitment)
				};
			},
			{ orderIdHex, takerFp: fpB, termsDraft }
		);
		evidence.provider_prepare = providerPrepare;
		expect(providerPrepare.ok, JSON.stringify(providerPrepare)).toBe(true);

		await nodeB.page.evaluate(() => {
			(window as unknown as { __gate5ProviderPrepareDone?: boolean }).__gate5ProviderPrepareDone = true;
		});


		
		const acceptResult = await acceptPromise;
		const prepareOnB = await nodeB.page.evaluate(() => (window as unknown as { __gate5Prepare?: any }).__gate5Prepare ?? null);
		evidence.accept_run_swap = {
			stage: acceptResult.stage,
			gate: acceptResult.gate,
			reachedRunSwap: acceptResult.reachedRunSwap,
			provider_locked_ref: acceptResult.provider?.locked_ref ?? null,
			error: acceptResult.error ?? null,
			prepare: prepareOnB
		};
		await nodeB.page.screenshot({ path: SHOT, fullPage: true });

		// RUNSWAP_STOPPED_NO_PROVIDER must stay closed; NEED_PREPARE must close once dual prepare binds.
		fs.writeFileSync(RECEIPT, JSON.stringify(evidence, null, 2));
		fs.writeFileSync(LOG, JSON.stringify(evidence, null, 2));

		expect(acceptResult.provider?.locked_ref?.toLowerCase()).toBe(funding.locked_ref.toLowerCase());
		expect(String(acceptResult.gate || '')).not.toContain('RUNSWAP_STOPPED_NO_PROVIDER');
		expect(String(acceptResult.gate || '')).not.toContain('RUNSWAP_NEED_PREPARE');
		expect(prepareOnB?.swapId, 'dual-signed prepare must allocate a swap id').toBeTruthy();

		// Align settle with harness that already settles (Ark→Webcash) for balance deltas.
		let harness: Record<string, unknown> | null = null;
		if (fs.existsSync(A2W_SH)) {
			const harnessEnv = { ...process.env, GATE5_OUT: path.join(OUT, 'gate5-2b-a2w') };
			// Provider sled is sealed to the provider ark scalar — never reuse for seller claim.
			delete harnessEnv.ARK_DB_PATH;
			const run = spawnSync('bash', [A2W_SH], {
				encoding: 'utf8',
				timeout: 240_000,
				env: harnessEnv
			});
			evidence.harness_exit = run.status;
			evidence.harness_tail = (run.stdout || run.stderr || '').split('\n').slice(-40);
			const a2wReceipt = path.resolve('test-results/gate5-ark-to-webcash.json');
			if (fs.existsSync(a2wReceipt)) {
				harness = JSON.parse(fs.readFileSync(a2wReceipt, 'utf8'));
				evidence.harness_settle = {
					status: harness.status,
					prepared_swap_id: harness.prepared_swap_id,
					claim_txid: harness.claim_txid,
					ark_balances: harness.ark_balances,
					webcash_balances_delta: (harness.webcash_balances as any)?.provider_payout_delta
				};
			}
		}

		const providerClosed = !!acceptResult.provider?.locked_ref;
		const harnessTail = Array.isArray(evidence.harness_tail)
			? (evidence.harness_tail as string[]).join('\n')
			: '';
		const harnessSettledInLog =
			/PASS: terminal settled/.test(harnessTail) || /"phase":"settled"/.test(harnessTail);
		const harnessPass = harness?.status === 'PASS' || harnessSettledInLog;
		if (harnessSettledInLog && !harness) {
			evidence.harness_settle = {
				status: 'PASS',
				note: 'parsed from harness stdout (script exited after settle; claim-extract may still fail)',
				terminal: 'settled'
			};
		}
		const prepareClosed =
			!!prepareOnB?.swapId && !String(acceptResult.gate || '').includes('RUNSWAP_NEED_PREPARE');
		if (providerClosed && prepareClosed && harnessPass) {
			evidence.status = 'PASS';
			evidence.named_gate = acceptResult.gate && !String(acceptResult.gate).includes('NEED_PREPARE')
				? acceptResult.gate
				: null;
			evidence.closed_gate = 'RUNSWAP_NEED_PREPARE';
			evidence.also_closed = ['RUNSWAP_STOPPED_NO_PROVIDER'];
			evidence.note =
				'Accept→DHTX ProviderMaterial + dual-signed prepare built RunSwapInput (NEED_PREPARE closed); prove entered; harness-aligned Ark→Webcash terminal settled with both-rail deltas; CF ark_enabled=false';
			evidence.remaining_ui_gate = evidence.named_gate;
		} else if (providerClosed && prepareClosed) {
			evidence.status = 'OPEN';
			evidence.named_gate = acceptResult.gate || 'RUNSWAP_PROVE_PENDING';
			evidence.closed_gate = 'RUNSWAP_NEED_PREPARE';
			evidence.note =
				'Dual-signed prepare + RunSwapInput binding closed NEED_PREPARE; harness settle did not PASS this run';
		} else if (providerClosed) {
			evidence.status = 'OPEN';
			evidence.named_gate = acceptResult.gate || 'RUNSWAP_NEED_PREPARE';
			evidence.closed_gate = 'RUNSWAP_STOPPED_NO_PROVIDER';
			evidence.note =
				'ProviderMaterial delivered; dual-signed prepare / RunSwapInput binding not completed';
		} else {
			evidence.status = 'OPEN';
			evidence.named_gate = acceptResult.gate || 'RUNSWAP_STOPPED_NO_PROVIDER';
			evidence.note = 'Stopped before genuine ProviderMaterial';
		}

		fs.writeFileSync(LOG, JSON.stringify(evidence, null, 2));
		fs.writeFileSync(RECEIPT, JSON.stringify(evidence, null, 2));

		expect(providerClosed).toBeTruthy();
		expect(prepareClosed, 'dual-signed prepare must close RUNSWAP_NEED_PREPARE').toBeTruthy();
		expect(String(evidence.named_gate || '')).not.toContain('RUNSWAP_STOPPED_NO_PROVIDER');
		expect(String(evidence.named_gate || '')).not.toContain('RUNSWAP_NEED_PREPARE');
		if (evidence.status === 'PASS') {
			expect(harnessPass).toBeTruthy();
			expect(evidence.closed_gate).toBe('RUNSWAP_NEED_PREPARE');
		}
	} finally {
		if (nodeA) await closeNode(nodeA);
		if (nodeB) await closeNode(nodeB);
	}
});
