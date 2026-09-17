/**
 * Product-path `buildRunSwapInput` — dual-signed prepare → RunSwapInput.
 *
 * Same sequence as the Gate5 e2e Accept path, using the live wallet mnemonic +
 * DeriveIdentity (no window.__mnemonic harness). Wired into ExchangeView so
 * Accept is not a dead-end at RUNSWAP_NEED_PREPARE when ark_enabled=true and
 * ProviderMaterial is present. With ark_enabled=false (CF pin),
 * attemptAcceptAndRunSwap still stops at ARK_DISABLED before calling this.
 */

import { getExtroClient } from '$lib/extro';
import { newRequestId, type WireProviderMaterial } from '$lib/extro/commands';
import { getRuntimeConfig } from '$lib/extro/runtime-config';
import {
	buildArkSwapContract,
	deriveVerifiedArkContractPlan
} from '$lib/ark/swap-contract';
import { getMnemonic } from '$lib/stores/wallet.svelte';
import {
	bearerSellerCountersignAndRelayPrepare,
	buildArkPrepareTermsFromProvider,
	expectationFromTerms,
	providerSignAndRelayPrepare,
	submitDualSignedPrepare
} from './accept-prepare';
import { providerMaterialFromWire } from './accept-run-swap';
import {
	getPrepareTermsDraft,
	markProviderPrepareDone,
	parsePrepareTermsDraft,
	publishPrepareTermsDraft,
	waitForProviderPrepareDone
} from './prepare-terms-draft';
import { HttpRefereeClient } from './referee-client';
import type { RunSwapInput } from './trade-store.svelte';
import type { LimitOrder } from './types';

const hexToBytes = (hex: string): Uint8Array => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0) throw new Error('hex length must be even');
	return Uint8Array.from({ length: clean.length / 2 }, (_, i) =>
		Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	);
};

const bytesToHex = (b: Uint8Array): string =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
	new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));

async function deriveBearerSellerIdentity(): Promise<{
	fpHex: string;
	pgpHex: string;
	cancelHex: string;
}> {
	const id = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot: 0 } }
	});
	if (id.kind !== 'Ok' || id.body.kind !== 'Identity') {
		throw new Error('DeriveIdentity failed — unlock the wallet before Accept→prepare');
	}
	const fpHex = id.body.fingerprint_hex.toLowerCase();
	const pgpHex = bytesToHex(id.body.verifying_key).toLowerCase();
	return { fpHex, pgpHex, cancelHex: pgpHex };
}

async function mintBearerWebcash(serverUrl: string): Promise<{ secret: string; publicToken: string }> {
	const mintRes = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Rail',
			cmd: { op: 'MintWebcash', index: 0, amount: '1', server_url: serverUrl }
		}
	});
	if (mintRes.kind !== 'Ok' || mintRes.body.kind !== 'WebcashMinted') {
		const detail =
			mintRes.kind === 'Err'
				? `${mintRes.code}: ${mintRes.message}`
				: `unexpected ${mintRes.kind}/${(mintRes as { body?: { kind?: string } }).body?.kind}`;
		throw new Error(`MintWebcash failed: ${detail}`);
	}
	return {
		secret: String(mintRes.body.secret),
		publicToken: String(mintRes.body.public_token)
	};
}

/** Taker/product builder used by ExchangeView Accept. */
export async function buildProductRunSwapInput(
	provider: WireProviderMaterial,
	order: LimitOrder
): Promise<RunSwapInput> {
	const cfg = getRuntimeConfig();
	if (!cfg.ark_enabled) throw new Error('PREPARE_REQUIRES_ARK: ark_enabled=false');

	const orderId16 = hexToBytes(order.id);
	if (orderId16.length !== 16) throw new Error('order id must be 16 bytes hex');

	const commitment = await sha256(orderId16);
	const idempotencyKey = (await sha256(new TextEncoder().encode(`idem:${order.id}`))).slice(0, 16);
	const nonce = await sha256(new TextEncoder().encode(`nonce:${order.id}`));
	const expiresAtUnix = Math.min(
		Math.max(1, Math.trunc(order.expiresAt)),
		Math.floor(Date.now() / 1000) + 3600
	);

	const bearer = await deriveBearerSellerIdentity();
	const terms = buildArkPrepareTermsFromProvider({
		orderId16,
		signedOrderCommitmentSha256: commitment,
		fillAmountRaw: BigInt(Math.max(1, Math.trunc(order.amount))),
		provider,
		bearerSellerFpHex: bearer.fpHex,
		bearerSellerPgpPubkeyHex: bearer.pgpHex,
		bearerSellerCancelPubkeyHex: bearer.cancelHex,
		providerArkDestination: 'ark:provider',
		bearerSellerArkDestination: 'ark:seller',
		arkAmountSats: 25_000n,
		idempotencyKey,
		nonce,
		expiresAtUnix
	});
	const expected = expectationFromTerms(terms);

	publishPrepareTermsDraft(order.id, terms);
	await waitForProviderPrepareDone(order.id, { timeoutMs: 90_000, intervalMs: 200 });

	const countersigned = await bearerSellerCountersignAndRelayPrepare({
		orderId16,
		providerFp: hexToBytes(order.makerFingerprint),
		expected,
		timeoutMs: 90_000,
		intervalMs: 300
	});

	const referee = new HttpRefereeClient({
		baseUrl: cfg.referee_url,
		pinnedPubkeyHex: cfg.referee_vk_hex
	});
	const refereeVk = hexToBytes(cfg.referee_vk_hex);
	const verified = await submitDualSignedPrepare({
		referee,
		refereeVk,
		orderId16,
		forFingerprint: hexToBytes(order.makerFingerprint),
		providerSigned: countersigned.providerSigned,
		bearerSellerSigned: countersigned.signed,
		expectedRequestCommitment: countersigned.requestCommitment,
		idempotencyKey: terms.idempotency_key,
		relay: true
	});

	const plan = await deriveVerifiedArkContractPlan({
		terms,
		signedResponse: verified.signedResponse,
		refereeVk
	});
	const arkContract = buildArkSwapContract(cfg as never, plan);

	const mnemonic = await getMnemonic();
	if (!mnemonic) throw new Error('wallet mnemonic unavailable — unlock/restore before Accept');

	const minted = await mintBearerWebcash(cfg.webcash_server_url);

	const conditional = new Uint8Array(128);
	conditional[0] = 0x00;
	conditional[1] = 0x00;
	conditional[2] = 0x00;
	conditional[3] = 0x40;
	crypto.getRandomValues(conditional.subarray(4, 68));
	const encSecretForProvider = new Uint8Array(64);
	crypto.getRandomValues(encSecretForProvider);

	const providerMat = providerMaterialFromWire(provider, conditional);
	const lockedMatch = /^([0-9a-f]{64}):(\d+)$/i.exec(provider.locked_ref);
	if (!lockedMatch) throw new Error(`bad locked_ref ${provider.locked_ref}`);
	const lockedTxid = lockedMatch[1].toLowerCase();
	const lockedVout = Number(lockedMatch[2]);

	return {
		order,
		mnemonic,
		provider: providerMat,
		bearerSeller: {
			bearer_seller_fp: bearer.fpHex,
			bearer_seller_pgp_pubkey: bearer.pgpHex,
			bearer_seller_cancel_pubkey_hex: bearer.cancelHex
		},
		encSecretForProvider,
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
								txid: lockedTxid,
								vout: lockedVout,
								script: arkContract.pkScriptHex,
								value: Number(plan.amountSats),
								createdAt: new Date(),
								isSpent: false,
								isSwept: false,
								isUnrolled: false
							}
						]
					}
				].filter((c) => c.contract.script === filter.script) as never as never;
			}
		},
		referee,
		afterInitiate: async (_swapId: string) => {
			const out1 = Array.from(crypto.getRandomValues(new Uint8Array(32)))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
			const out2 = Array.from(crypto.getRandomValues(new Uint8Array(32)))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
			const body = {
				webcashes: [minted.secret],
				new_webcashes: [`e0.4:secret:${out1}`, `e0.6:secret:${out2}`],
				legalese: { terms: true }
			};
			const r = await fetch(`${cfg.webcash_server_url}/api/v1/replace`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!r.ok) {
				const t = await r.text();
				throw new Error(`afterInitiate replace HTTP ${r.status}: ${t.slice(0, 200)}`);
			}
		}
	};
}

/** Maker-side: sign a published prepare-terms draft and relay to the bearer. */
export async function signPrepareTermsDraftAsProvider(input: {
	orderIdHex: string;
	bearerSellerFpHex: string;
	slot?: number;
}): Promise<{ ok: true; delivered: boolean } | { ok: false; reason: string }> {
	const draft = getPrepareTermsDraft(input.orderIdHex);
	if (!draft) return { ok: false, reason: 'no prepare-terms draft published for this order' };
	const terms = parsePrepareTermsDraft(draft);
	const signed = await providerSignAndRelayPrepare({
		terms,
		orderId16: hexToBytes(input.orderIdHex),
		bearerSellerFp: hexToBytes(input.bearerSellerFpHex),
		slot: input.slot
	});
	markProviderPrepareDone(input.orderIdHex);
	return { ok: true, delivered: signed.delivered };
}
