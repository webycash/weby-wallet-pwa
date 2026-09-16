/**
 * Deterministic Ark settle / provider-only refund spend path for the
 * `webycash-musig2-v2` contract.
 *
 * Protocol path (confirmed): `@arkade-os/sdk@0.4.66` + RestArkProvider +
 * DefaultVtxo forfeit (aggregate owner + operator) + CSVMultisig recovery
 * (provider key only) + OP_RETURN request-commitment leaf.
 *
 * This module builds canonical *templates* (leaf selection, destinations,
 * locked_ref binding) and refuses generic wallet spend. Dedicated MuSig2 /
 * CSV signing against a live funded VTXO remains a named gate until regtest
 * funding evidence exists — do not claim settled from templates alone.
 */

import { GATE_REFUND_SIGNER_PENDING, GATE_SETTLE_SIGNER_PENDING, NamedArkGateError } from './named-gates';
import type { VerifiedArkContractPlan } from './swap-contract';

export type ArkSpendLeaf = 'collaborative-settle' | 'provider-csv-refund';

export interface ArkSpendTemplate {
	leaf: ArkSpendLeaf;
	/** Exact VTXO outpoint `txid:vout`. */
	lockedRef: string;
	amountSats: bigint;
	/** Destination Ark address for this path. */
	destination: string;
	network: VerifiedArkContractPlan['network'];
	swapId: string;
	requestCommitmentHex: string;
	aggregateOwnerKeyHex: string;
	providerRecoveryKeyHex: string;
	operatorSignerKeyHex: string;
	unilateralExitDelay: bigint;
	/** SHA-256 of the canonical template bytes (fixtures / referee binding). */
	templateDigestHex: string;
}

const bytesToHex = (value: Uint8Array): string =>
	Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

const exactLockedRef = (lockedRef: string): string => {
	const match = /^([0-9a-f]{64}):(\d+)$/i.exec(lockedRef);
	if (!match) throw new Error('Ark locked_ref must be an exact txid:vout');
	const vout = Number(match[2]);
	if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff) {
		throw new Error('Ark locked_ref vout is outside the u32 range');
	}
	return `${match[1].toLowerCase()}:${vout}`;
};

/** Canonical UTF-8 bytes used for digest fixtures (order-stable, no whitespace noise). */
export function canonicalSpendTemplateBytes(input: Omit<ArkSpendTemplate, 'templateDigestHex'>): Uint8Array {
	const lines = [
		`leaf=${input.leaf}`,
		`locked_ref=${input.lockedRef}`,
		`amount_sats=${input.amountSats.toString()}`,
		`destination=${input.destination}`,
		`network=${input.network}`,
		`swap_id=${input.swapId}`,
		`request_commitment=${input.requestCommitmentHex}`,
		`aggregate_owner=${input.aggregateOwnerKeyHex}`,
		`provider_recovery=${input.providerRecoveryKeyHex}`,
		`operator_signer=${input.operatorSignerKeyHex}`,
		`unilateral_exit_delay=${input.unilateralExitDelay.toString()}`
	];
	return new TextEncoder().encode(lines.join('\n'));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
	return bytesToHex(new Uint8Array(digest));
}

function baseFields(plan: VerifiedArkContractPlan, lockedRef: string) {
	return {
		lockedRef: exactLockedRef(lockedRef),
		amountSats: plan.amountSats,
		network: plan.network,
		swapId: plan.swapId,
		requestCommitmentHex: bytesToHex(plan.requestCommitment),
		aggregateOwnerKeyHex: bytesToHex(plan.aggregateOwnerKey),
		providerRecoveryKeyHex: bytesToHex(plan.providerRecoveryKey),
		operatorSignerKeyHex: bytesToHex(plan.operatorSignerKey),
		unilateralExitDelay: plan.unilateralExitDelay
	};
}

/** Collaborative settle: forfeit leaf → bearer-seller destination. */
export async function buildSettleTemplate(
	plan: VerifiedArkContractPlan,
	lockedRef: string
): Promise<ArkSpendTemplate> {
	const base = baseFields(plan, lockedRef);
	const partial = {
		...base,
		leaf: 'collaborative-settle' as const,
		destination: plan.bearerSellerDestination
	};
	const templateDigestHex = await sha256Hex(canonicalSpendTemplateBytes(partial));
	return { ...partial, templateDigestHex };
}

/** Provider-only CSV refund: recovery leaf → provider destination (never MuSig2). */
export async function buildRefundTemplate(
	plan: VerifiedArkContractPlan,
	lockedRef: string
): Promise<ArkSpendTemplate> {
	const base = baseFields(plan, lockedRef);
	const partial = {
		...base,
		leaf: 'provider-csv-refund' as const,
		destination: plan.providerDestination
	};
	const templateDigestHex = await sha256Hex(canonicalSpendTemplateBytes(partial));
	return { ...partial, templateDigestHex };
}

/** Optional backend that produces a real co-sign receipt against a funded VTXO. */
export interface DedicatedCosignBackend {
	/** Provider MuSig2 settle partial (hex) + optional operator/ASP observe ref. */
	signSettle(template: ArkSpendTemplate): Promise<DedicatedCosignReceipt>;
	/** Provider-only CSV recovery signature / package hex. */
	signRefund(template: ArkSpendTemplate): Promise<DedicatedCosignReceipt>;
}

export interface DedicatedCosignReceipt {
	/** Hex of the produced signature or MuSig2 partial — never a placeholder digest. */
	signatureHex: string;
	/** Optional ASP / operator observation reference (non-blocking). */
	aspRef?: string;
}

let cosignBackend: DedicatedCosignBackend | null = null;

/** Inject a regtest/signet cosign backend (tests / harness). Production leaves null. */
export function setDedicatedCosignBackend(backend: DedicatedCosignBackend | null): void {
	cosignBackend = backend;
}

/**
 * Dedicated settle signer entry. Uses an injected cosign backend when present
 * (regtest/signet harness). Otherwise fails closed — never returns dummy hashes.
 */
export async function signSettlePartial(template: ArkSpendTemplate): Promise<DedicatedCosignReceipt> {
	if (!cosignBackend) throw new NamedArkGateError(GATE_SETTLE_SIGNER_PENDING);
	const receipt = await cosignBackend.signSettle(template);
	if (!/^[0-9a-f]+$/i.test(receipt.signatureHex) || receipt.signatureHex.length < 64) {
		throw new Error('settle cosign receipt is malformed');
	}
	if (/^(ab|cf){32}$/i.test(receipt.signatureHex) || /^0+$/i.test(receipt.signatureHex)) {
		throw new Error('settle cosign rejects placeholder signatures');
	}
	return receipt;
}

/**
 * Dedicated provider-recovery signer entry. Injected backend on regtest/signet;
 * otherwise named gate until CSV can sign a real unspent VTXO.
 */
export async function signRefundRecovery(template: ArkSpendTemplate): Promise<DedicatedCosignReceipt> {
	if (!cosignBackend) throw new NamedArkGateError(GATE_REFUND_SIGNER_PENDING);
	const receipt = await cosignBackend.signRefund(template);
	if (!/^[0-9a-f]+$/i.test(receipt.signatureHex) || receipt.signatureHex.length < 64) {
		throw new Error('refund cosign receipt is malformed');
	}
	if (/^(ab|cf){32}$/i.test(receipt.signatureHex) || /^0+$/i.test(receipt.signatureHex)) {
		throw new Error('refund cosign rejects placeholder signatures');
	}
	return receipt;
}

/** Named spending paths exposed to the contract handler (not generically spendable). */
export const DEDICATED_SPEND_PATHS: ReadonlyArray<{ id: ArkSpendLeaf; label: string }> = [
	{ id: 'collaborative-settle', label: 'dedicated MuSig2 collaborative settle' },
	{ id: 'provider-csv-refund', label: 'dedicated provider-only CSV refund' }
];
