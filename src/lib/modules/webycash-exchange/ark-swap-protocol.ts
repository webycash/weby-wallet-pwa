/**
 * Two-party Ark swap protocol (blocker 3): pre-funding OFFER → referee terms →
 * verified contract → funding gate → provider material.
 *
 * Roles follow the order side, not maker/taker:
 *   - provider      = the party paying Ark (buys webcash),
 *   - bearer seller = the party selling webcash for Ark.
 *
 * Every key operation stays inside the extro-node WASM (SendProviderOffer,
 * SignSwapPrepare, InspectSwapPrepare, CountersignSwapPrepare, ArkSchnorrSign,
 * ProviderPartialSign); all fail closed while the wallet is locked. Nothing
 * here fabricates a terminal: with too little Ark balance the provider stops at
 * ARK_FUNDING_INSUFFICIENT and the seller at ARK_AWAITING_PROVIDER_FUNDING.
 */
import { getExtroClient } from '$lib/extro';
import { getSelfIdentity } from '$lib/extro/self-identity';
import { newRequestId, type ArkPrepareTerms, type WireProviderMaterial } from '$lib/extro/commands';
import { getRuntimeConfig } from '$lib/extro/runtime-config';
import { loadArkOverview } from '$lib/ark/ark-view';
import {
	GATE_ARK_AWAITING_PROVIDER_FUNDING,
	GATE_ARK_FUNDING_INSUFFICIENT,
	GATE_SETTLE_SIGNER_PENDING,
	NamedArkGateError
} from '$lib/ark/named-gates';
import { assertFundedLockedRef, resolveFundedLockedRef, type ArkIndexerReader } from '$lib/ark/funded-ref';
import { fundingRefsFromTemplates } from '$lib/ark/provider-material';
import type { VerifiedArkContractPlan } from '$lib/ark/swap-contract';
import {
	buildArkSwapContract,
	deriveVerifiedArkContractPlan,
	fundArkSwapContract,
	type ArkSwapContract
} from '$lib/ark/swap-contract';
import { WasmArkIdentity } from '$lib/ark/wasm-identity';
import {
	buildArkPrepareTermsFromProvider,
	expectationFromTerms,
	orderIdToPrepareOrderId,
	PREPARE_MAX_TTL_SECS,
	submitDualSignedPrepare
} from './accept-prepare';
import { fetchSwapMsgs, probeProviderMaterial } from './accept-run-swap';
import { HttpRefereeClient } from './referee-client';
import {
	countersignSwapPrepare,
	fetchSwapPrepareInbox,
	relaySwapPrepareSignature,
	signSwapPrepare
} from './swap-prepare';
import type { LimitOrder } from './types';

export const PROVIDER_OFFER_PREFIX = 'offer:';

export type SwapRole = 'provider' | 'bearer-seller';

export type SwapPhase =
	| 'accept-sent'
	| 'accept-received'
	| 'offer-sent'
	| 'awaiting-offer'
	| 'offer-received'
	| 'terms-signed'
	| 'awaiting-terms'
	| 'terms-countersigned'
	| 'awaiting-countersign'
	| 'prepared'
	| 'awaiting-prepared'
	| 'contract-derived'
	| 'funding'
	| 'funded'
	| 'material-sent'
	| 'awaiting-material'
	| 'material-received'
	| 'gate'
	| 'error';

export type SwapProgress = {
	role: SwapRole;
	phase: SwapPhase;
	message: string;
	gate?: string;
	contractAddress?: string;
	arkAmountSats?: string;
	swapId?: string;
};

export type ProtocolOpts = {
	slot?: number;
	stepTimeoutMs?: number;
	fundingWaitMs?: number;
	intervalMs?: number;
	onProgress?: (p: SwapProgress) => void;
};

const hexToBytes = (hex: string): Uint8Array => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) throw new Error('bad hex');
	return Uint8Array.from({ length: clean.length / 2 }, (_, i) =>
		Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	);
};
const bytesToHex = (b: Uint8Array): string =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
	a.length === b.length && a.every((x, i) => x === b[i]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
	new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));

/** Which party pays Ark for this order? Decided by side + pair, never by maker/taker. */
export function makerRole(order: LimitOrder): SwapRole {
	const baseIsArk = order.pair.base === 'BitcoinArk';
	const quoteIsArk = order.pair.quote === 'BitcoinArk';
	if (!baseIsArk && !quoteIsArk) throw new Error('order pair has no Bitcoin ARK leg');
	// Maker buying the non-Ark base pays Ark (provider); maker buying Ark base sells webcash.
	const makerPaysArk = baseIsArk ? order.side === 'sell' : order.side === 'buy';
	return makerPaysArk ? 'provider' : 'bearer-seller';
}

export function takerRole(order: LimitOrder): SwapRole {
	return makerRole(order) === 'provider' ? 'bearer-seller' : 'provider';
}

/** Exact Ark leg in sats: maker price (sats per base unit) × amount. */
export function arkAmountSatsFor(order: LimitOrder): bigint {
	const baseIsArk = order.pair.base === 'BitcoinArk';
	const sats = baseIsArk ? Math.trunc(order.amount) : Math.round(order.price * order.amount);
	if (!Number.isSafeInteger(sats) || sats <= 0) throw new Error('order has no positive Ark amount');
	return BigInt(sats);
}

function fillAmountRawFor(order: LimitOrder): bigint {
	const baseIsArk = order.pair.base === 'BitcoinArk';
	const raw = baseIsArk ? Math.round(order.price * order.amount) : Math.trunc(order.amount);
	return BigInt(Math.max(1, raw));
}

async function selfIdentity(slot: number): Promise<{ fpHex: string; pgpHex: string }> {
	const id = await getSelfIdentity(getExtroClient(), slot);
	return { fpHex: id.fingerprintHex, pgpHex: bytesToHex(id.verifyingKey).toLowerCase() };
}

async function poll<T>(
	what: string,
	fn: () => Promise<T | null>,
	timeoutMs: number,
	intervalMs: number
): Promise<T | null> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			const v = await fn();
			if (v) return v;
		} catch (e) {
			lastErr = e;
		}
		await sleep(intervalMs);
	}
	if (lastErr) throw new Error(`${what}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
	return null;
}

async function sendProviderOffer(input: {
	slot: number;
	orderId16: Uint8Array;
	counterpartyFp: Uint8Array;
	arkDestination: string;
}): Promise<boolean> {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: {
				op: 'SendProviderOffer',
				slot: input.slot,
				order_id: input.orderId16,
				counterparty_fp: input.counterpartyFp,
				provider_ark_destination: input.arkDestination
			}
		}
	});
	if (res.kind === 'Err') throw new Error(`SendProviderOffer: ${res.message}`);
	if (res.body.kind !== 'SwapMsgSent') throw new Error(`SendProviderOffer: unexpected ${res.body.kind}`);
	return res.body.delivered;
}

async function inspectSwapPrepare(signed: Uint8Array): Promise<ArkPrepareTerms> {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Scheme402', cmd: { op: 'InspectSwapPrepare', counterparty_signed: signed } }
	});
	if (res.kind === 'Err') throw new Error(`InspectSwapPrepare: ${res.message}`);
	if (res.body.kind !== 'SwapPrepareTerms') {
		throw new Error(`InspectSwapPrepare: unexpected ${res.body.kind}`);
	}
	return res.body.terms;
}

function refereeFromConfig() {
	const cfg = getRuntimeConfig();
	return {
		referee: new HttpRefereeClient({ baseUrl: cfg.referee_url, pinnedPubkeyHex: cfg.referee_vk_hex }),
		refereeVk: hexToBytes(cfg.referee_vk_hex)
	};
}

/** Provider checks every field it owns before countersigning seller-built terms. */
export function assertProviderOwnedTerms(input: {
	terms: ArkPrepareTerms;
	offer: WireProviderMaterial;
	selfFpHex: string;
	arkDestination: string;
	orderId16: Uint8Array;
	counterpartyFpHex: string;
	arkAmountSats: bigint;
}): void {
	const { terms, offer } = input;
	const cfg = getRuntimeConfig();
	const fail = (m: string): never => {
		throw new Error(`provider rejected prepare terms: ${m}`);
	};
	if (!sameBytes(terms.order_id, orderIdToPrepareOrderId(input.orderId16))) fail('order id');
	if (terms.parties.provider_fp.toLowerCase() !== input.selfFpHex) fail('provider fingerprint');
	if (terms.parties.provider_pgp_pubkey_hex.toLowerCase() !== bytesToHex(offer.provider_pgp_pubkey)) {
		fail('provider pgp key');
	}
	if (terms.parties.bearer_seller_fp.toLowerCase() !== input.counterpartyFpHex.toLowerCase()) {
		fail('bearer seller is not the accepting counterparty');
	}
	if (terms.parties.provider_musig2_pubkey.toLowerCase() !== offer.provider_musig2_pubkey.toLowerCase()) {
		fail('provider musig2 key');
	}
	if (terms.parties.provider_cancel_pubkey_hex.toLowerCase() !== offer.provider_cancel_pubkey_hex.toLowerCase()) {
		fail('provider cancel key');
	}
	if (terms.provider_nonces.settle_nonce_pub.toLowerCase() !== offer.settle_nonce_pub.toLowerCase()) {
		fail('settle nonce');
	}
	if (terms.provider_nonces.refund_nonce_pub.toLowerCase() !== offer.refund_nonce_pub.toLowerCase()) {
		fail('refund nonce');
	}
	if (terms.provider_ark_destination !== input.arkDestination) fail('provider Ark destination');
	if (terms.ark_network !== cfg.ark_network) fail('Ark network');
	if (bytesToHex(terms.ark_operator_signer_pk) !== cfg.ark_signer_pk_hex.toLowerCase()) fail('operator key');
	if (bytesToHex(terms.ark_operator_info_digest) !== cfg.ark_info_digest_hex.toLowerCase()) fail('operator digest');
	if (terms.ark_unilateral_exit_delay !== BigInt(cfg.ark_unilateral_exit_delay)) fail('exit delay');
	if (terms.ark_amount_sats !== input.arkAmountSats) fail('Ark amount differs from the order');
	if (!terms.bearer_seller_ark_destination) fail('bearer seller Ark destination');
	const now = Math.floor(Date.now() / 1000);
	if (terms.expires_at_unix <= now || terms.expires_at_unix > now + PREPARE_MAX_TTL_SECS + 120) fail('expiry window');
}

async function deriveContract(
	terms: ArkPrepareTerms,
	signedResponse: Uint8Array,
	refereeVk: Uint8Array
): Promise<ArkSwapContract> {
	const plan = await deriveVerifiedArkContractPlan({ terms, signedResponse, refereeVk });
	return buildArkSwapContract(getRuntimeConfig() as never, plan);
}

/**
 * Provider side. `counterpartyFpHex` is the bearer seller (the taker when the
 * maker provides, the maker when the taker provides).
 */
export async function runProviderSide(
	order: LimitOrder,
	counterpartyFpHex: string,
	opts: ProtocolOpts = {}
): Promise<SwapProgress> {
	const slot = opts.slot ?? 0;
	const stepTimeoutMs = opts.stepTimeoutMs ?? 120_000;
	const intervalMs = opts.intervalMs ?? 1_000;
	const emit = (p: Omit<SwapProgress, 'role'>): SwapProgress => {
		const out = { role: 'provider' as const, ...p };
		opts.onProgress?.(out);
		return out;
	};
	const orderId16 = hexToBytes(order.id);
	const counterpartyFp = hexToBytes(counterpartyFpHex);
	const arkAmountSats = arkAmountSatsFor(order);
	const me = await selfIdentity(slot);
	const overview = await loadArkOverview();

	const delivered = await sendProviderOffer({
		slot,
		orderId16,
		counterpartyFp,
		arkDestination: overview.arkAddress
	});
	emit({ phase: 'offer-sent', message: `pre-funding offer sent (delivered=${delivered}); awaiting seller terms` });

	const ownOffer = (await fetchSwapMsgs(order.id)).provider;
	if (!ownOffer || !ownOffer.locked_ref.startsWith(PROVIDER_OFFER_PREFIX)) {
		throw new Error('own provider offer not recorded in the swap inbox');
	}

	emit({ phase: 'awaiting-terms', message: 'waiting for the bearer seller to sign prepare terms' });
	const sellerSigned = await poll(
		'awaiting seller terms',
		async () => (await fetchSwapPrepareInbox(orderId16)).bearerSellerSigned,
		stepTimeoutMs,
		intervalMs
	);
	if (!sellerSigned) throw new Error('timed out waiting for bearer seller prepare terms');

	const terms = await inspectSwapPrepare(sellerSigned);
	assertProviderOwnedTerms({
		terms,
		offer: ownOffer,
		selfFpHex: me.fpHex,
		arkDestination: overview.arkAddress,
		orderId16,
		counterpartyFpHex,
		arkAmountSats
	});
	const countersigned = await countersignSwapPrepare(sellerSigned, expectationFromTerms(terms), slot);
	await relaySwapPrepareSignature({
		orderId: orderId16,
		forFingerprint: counterpartyFp,
		role: 'Provider',
		signedPrepare: countersigned.signed,
		slot
	});
	emit({ phase: 'terms-countersigned', message: 'terms validated and countersigned; awaiting referee prepare' });

	const signedResponse = await poll(
		'awaiting referee prepare',
		async () => (await fetchSwapPrepareInbox(orderId16)).signedResponse,
		stepTimeoutMs,
		intervalMs
	);
	if (!signedResponse) throw new Error('timed out waiting for the referee-prepared response');
	const { refereeVk } = refereeFromConfig();
	const contract = await deriveContract(terms, signedResponse, refereeVk);
	const facts = {
		contractAddress: contract.address,
		arkAmountSats: contract.plan.amountSats.toString(),
		swapId: contract.plan.swapId
	};
	emit({ phase: 'contract-derived', message: 'referee-verified 2-of-2 contract derived', ...facts });

	const fresh = await loadArkOverview();
	if (BigInt(fresh.offchainSats) < contract.plan.amountSats) {
		throw Object.assign(
			new NamedArkGateError(
				`${GATE_ARK_FUNDING_INSUFFICIENT} (have=${fresh.offchainSats} sat, need=${contract.plan.amountSats} sat, contract=${contract.address})`
			),
			{ facts }
		);
	}
	emit({ phase: 'funding', message: 'funding the 2-of-2 VTXO from the WASM-signed Ark wallet', ...facts });
	const { Wallet } = await import('@arkade-os/sdk');
	const wallet = await Wallet.create({
		identity: new WasmArkIdentity(slot),
		arkServerUrl: getRuntimeConfig().ark_asp_url
	});
	const funded = await fundArkSwapContract(wallet as never, contract);
	emit({ phase: 'funded', message: `funded via Ark tx ${funded.arkTxId}`, ...facts });

	// Publish provider material bound to the exact funded outpoint: settle/refund
	// template digests over (plan, locked_ref) + the WASM MuSig2 pubkey/nonces for
	// fill `order_id:counterparty_fp` (the same nonces the later partial-sign uses).
	const lockedRef = await resolveFundedLockedRef(await arkIndexer(), contract, funded.arkTxId, {
		intervalMs
	});
	const refs = await fundingRefsFromTemplates(contract.plan, lockedRef);
	const sent = await probeProviderMaterial(order, counterpartyFpHex, slot, refs);
	if (!sent.ok) throw Object.assign(new NamedArkGateError(sent.gate), { facts });
	emit({ phase: 'material-sent', message: `provider material sent for ${lockedRef}`, ...facts });
	// Next: referee settle ceremony (referee nonce/partial) → WasmProviderCosignBackend.
	throw Object.assign(
		new NamedArkGateError(`${GATE_SETTLE_SIGNER_PENDING} (locked_ref=${lockedRef}, settle=${refs.txSettleHashHex})`),
		{ facts }
	);
}

async function arkIndexer(): Promise<ArkIndexerReader> {
	const { RestIndexerProvider } = await import('@arkade-os/sdk');
	return new RestIndexerProvider(getRuntimeConfig().ark_asp_url) as unknown as ArkIndexerReader;
}

/**
 * Seller-side check of published provider material: the hashes must equal the
 * seller's OWN settle/refund templates over (verified plan, locked_ref).
 */
export async function verifyProviderMaterialAgainstPlan(
	material: Pick<WireProviderMaterial, 'locked_ref' | 'tx_settle_hash_hex' | 'tx_refund_hash_hex'>,
	plan: VerifiedArkContractPlan
): Promise<{ lockedRef: string; txSettleHashHex: string; txRefundHashHex: string }> {
	const own = await fundingRefsFromTemplates(plan, material.locked_ref);
	if (material.tx_settle_hash_hex.toLowerCase() !== own.txSettleHashHex) {
		throw new Error('provider settle template hash does not match the referee-verified plan');
	}
	if (material.tx_refund_hash_hex.toLowerCase() !== own.txRefundHashHex) {
		throw new Error('provider refund template hash does not match the referee-verified plan');
	}
	return { lockedRef: own.lockedRef, txSettleHashHex: own.txSettleHashHex, txRefundHashHex: own.txRefundHashHex };
}

/** Bearer-seller side: wait for the provider offer, build + sign the terms, prepare. */
export async function runBearerSellerSide(
	order: LimitOrder,
	providerFpHex: string,
	opts: ProtocolOpts = {}
): Promise<SwapProgress> {
	const slot = opts.slot ?? 0;
	const stepTimeoutMs = opts.stepTimeoutMs ?? 120_000;
	const fundingWaitMs = opts.fundingWaitMs ?? 45_000;
	const intervalMs = opts.intervalMs ?? 1_000;
	const emit = (p: Omit<SwapProgress, 'role'>): SwapProgress => {
		const out = { role: 'bearer-seller' as const, ...p };
		opts.onProgress?.(out);
		return out;
	};
	const orderId16 = hexToBytes(order.id);
	const providerFp = hexToBytes(providerFpHex);
	emit({ phase: 'awaiting-offer', message: 'waiting for the provider pre-funding offer' });
	const offer = await poll(
		'awaiting provider offer',
		async () => {
			const p = (await fetchSwapMsgs(order.id)).provider;
			return p && bytesToHex(p.provider_fp) === providerFpHex.toLowerCase() ? p : null;
		},
		stepTimeoutMs,
		intervalMs
	);
	if (!offer) throw new Error('timed out waiting for the provider pre-funding offer');
	if (!offer.locked_ref.startsWith(PROVIDER_OFFER_PREFIX)) {
		throw new Error('provider skipped the pre-funding offer');
	}
	const providerArkDestination = offer.locked_ref.slice(PROVIDER_OFFER_PREFIX.length);
	emit({ phase: 'offer-received', message: 'provider offer received' });

	const me = await selfIdentity(slot);
	const overview = await loadArkOverview();
	const commitment = await sha256(orderId16);
	const terms = buildArkPrepareTermsFromProvider({
		orderId16,
		signedOrderCommitmentSha256: commitment,
		fillAmountRaw: fillAmountRawFor(order),
		provider: offer,
		allowOffer: true,
		bearerSellerFpHex: me.fpHex,
		bearerSellerPgpPubkeyHex: me.pgpHex,
		bearerSellerCancelPubkeyHex: me.pgpHex,
		providerArkDestination,
		bearerSellerArkDestination: overview.arkAddress,
		arkAmountSats: arkAmountSatsFor(order),
		expiresAtUnix: Math.min(Math.max(1, Math.trunc(order.expiresAt)), Math.floor(Date.now() / 1000) + PREPARE_MAX_TTL_SECS)
	});
	const signed = await signSwapPrepare(terms, slot);
	await relaySwapPrepareSignature({
		orderId: orderId16,
		forFingerprint: providerFp,
		role: 'BearerSeller',
		signedPrepare: signed.signed,
		slot
	});
	emit({ phase: 'terms-signed', message: 'terms signed and sent; awaiting provider countersignature' });

	const providerSigned = await poll(
		'awaiting provider countersignature',
		async () => (await fetchSwapPrepareInbox(orderId16)).providerSigned,
		stepTimeoutMs,
		intervalMs
	);
	if (!providerSigned) throw new Error('timed out waiting for the provider countersignature');
	const { referee, refereeVk } = refereeFromConfig();
	const verified = await submitDualSignedPrepare({
		referee,
		refereeVk,
		orderId16,
		forFingerprint: providerFp,
		providerSigned,
		bearerSellerSigned: signed.signed,
		expectedRequestCommitment: signed.requestCommitment,
		idempotencyKey: terms.idempotency_key,
		relay: true,
		slot
	});
	emit({ phase: 'prepared', message: `referee prepared swap ${verified.swapId}` });
	const contract = await deriveContract(terms, verified.signedResponse, refereeVk);
	const facts = {
		contractAddress: contract.address,
		arkAmountSats: contract.plan.amountSats.toString(),
		swapId: contract.plan.swapId
	};
	emit({ phase: 'contract-derived', message: 'referee-verified 2-of-2 contract derived', ...facts });

	emit({ phase: 'awaiting-material', message: 'waiting for the provider to fund the contract', ...facts });
	const material = await poll(
		'awaiting provider funding',
		async () => {
			const p = (await fetchSwapMsgs(order.id)).provider;
			return p && /^[0-9a-f]{64}:\d+$/i.test(p.locked_ref) ? p : null;
		},
		fundingWaitMs,
		intervalMs
	).catch(() => null);
	if (!material) {
		throw Object.assign(
			new NamedArkGateError(
				`${GATE_ARK_AWAITING_PROVIDER_FUNDING} (contract=${contract.address}, amount=${contract.plan.amountSats} sat)`
			),
			{ facts }
		);
	}
	const checked = await verifyProviderMaterialAgainstPlan(material, contract.plan);
	await assertFundedLockedRef(await arkIndexer(), contract, checked.lockedRef);
	emit({
		phase: 'material-received',
		message: `provider funded ${checked.lockedRef}; settle/refund hashes match own templates`,
		...facts
	});
	throw Object.assign(
		new NamedArkGateError(`${GATE_SETTLE_SIGNER_PENDING} (locked_ref=${checked.lockedRef}, settle=${checked.txSettleHashHex})`),
		{ facts }
	);
}

/** Run whichever role this wallet holds; converts errors/gates into a terminal progress. */
export async function runSwapRole(
	role: SwapRole,
	order: LimitOrder,
	counterpartyFpHex: string,
	opts: ProtocolOpts = {}
): Promise<SwapProgress> {
	try {
		return role === 'provider'
			? await runProviderSide(order, counterpartyFpHex, opts)
			: await runBearerSellerSide(order, counterpartyFpHex, opts);
	} catch (e) {
		const facts = (e as { facts?: Partial<SwapProgress> }).facts ?? {};
		const out: SwapProgress =
			e instanceof NamedArkGateError
				? { role, phase: 'gate', gate: e.gate, message: e.gate, ...facts }
				: { role, phase: 'error', message: e instanceof Error ? e.message : String(e), ...facts };
		opts.onProgress?.(out);
		return out;
	}
}
