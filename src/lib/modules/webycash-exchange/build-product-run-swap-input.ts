/**
 * Product-path `buildRunSwapInput` (ExchangeView → attemptAcceptAndRunSwap).
 *
 * Production rules (mainnet): nothing here mints, mines, or replaces webcash,
 * and no amount is hardcoded. The bearer leg is the wallet's own webcash
 * handle and must be a live, unspent token on the rail that covers the
 * order's fill (`assertBearerLegIssued`; `spent:null` = never issued → gate).
 * Ark/fill amounts come from the order (`arkAmountSatsFor` / `fillAmountRawFor`).
 *
 * This legacy entry only ever sees ProviderMaterial that is ALREADY funded
 * (`locked_ref` = real outpoint), i.e. the maker funded before the referee
 * pre-check passed. That ordering strands funds, so it is refused with a named
 * gate; swaps run through `runSwapRole` (offer → prepare → referee pre-check →
 * fund), which never funds before the pre-check.
 */

import { getRuntimeConfig } from '$lib/extro/runtime-config';
import type { WireProviderMaterial } from '$lib/extro/commands';
import {
	GATE_REFEREE_PRECHECK_PENDING,
	GATE_RUNSWAP_NEED_PREPARE,
	NamedArkGateError
} from '$lib/ark/named-gates';
import { getPrepareTermsDraft, markProviderPrepareDone, parsePrepareTermsDraft } from './prepare-terms-draft';
import { providerSignAndRelayPrepare } from './accept-prepare';
import { arkAmountSatsFor, fillAmountRawFor } from './ark-swap-protocol';
import { assertBearerLegIssued } from './bearer-precheck';
import { bearerLegFromWallet } from './swap-facts';
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

/** Taker/product builder used by ExchangeView Accept. Fails closed; never mints. */
export async function buildProductRunSwapInput(
	provider: WireProviderMaterial,
	order: LimitOrder
): Promise<RunSwapInput> {
	const cfg = getRuntimeConfig();
	if (!cfg.ark_enabled) throw new Error('PREPARE_REQUIRES_ARK: ark_enabled=false');
	if (hexToBytes(order.id).length !== 16) throw new Error('order id must be 16 bytes hex');

	// Amounts come from the order — never a constant.
	const arkAmountSats = arkAmountSatsFor(order);
	const fillAmountRaw = fillAmountRawFor(order);

	// The taker's real webcash: its own handle H must be live + unspent on the rail.
	const leg = await bearerLegFromWallet(0, 0, fillAmountRaw);
	const publicWebcash = `e${leg.bearerAmount}:public:${bytesToHex(leg.publicTokenHash)}`;
	await assertBearerLegIssued({
		railBase: cfg.webcash_server_url,
		publicWebcash,
		fillAmount: leg.bearerAmount
	});

	if (/^[0-9a-f]{64}:\d+$/i.test(provider.locked_ref)) {
		throw new NamedArkGateError(
			`${GATE_REFEREE_PRECHECK_PENDING} (provider already funded ${provider.locked_ref} for ${arkAmountSats} sat before the referee pre-check; refusing — run the role protocol)`
		);
	}
	throw new NamedArkGateError(GATE_RUNSWAP_NEED_PREPARE);
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
