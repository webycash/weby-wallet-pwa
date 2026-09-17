/**
 * Assemble + validate genuine Ark ProviderMaterial for Gate 3.
 *
 * Rejects historical placeholders (`v…` locked_ref, `ab…`/`cf…` hashes).
 * Settle/refund hashes MUST be distinct (XOR terminals). Prefer digests from
 * `buildSettleTemplate` / `buildRefundTemplate` until live sighashes exist.
 */

import type { WireProviderMaterial } from '$lib/extro/commands';
import {
	buildRefundTemplate,
	buildSettleTemplate,
	type ArkSpendTemplate
} from './swap-spend';
import type { VerifiedArkContractPlan } from './swap-contract';

const PLACEHOLDER_SETTLE = 'ab'.repeat(32);
const PLACEHOLDER_REFUND = 'cf'.repeat(32);

export function exactLockedRef(lockedRef: string): string {
	if (lockedRef.startsWith('ark:vtxo:') || /^v+$/i.test(lockedRef)) {
		throw new Error('locked_ref rejects commitment-only placeholders');
	}
	const match = /^([0-9a-f]{64}):(\d+)$/i.exec(lockedRef);
	if (!match) throw new Error('locked_ref must be a real Ark VTXO outpoint (`txid:vout`)');
	if (/^v+$/i.test(match[1])) {
		throw new Error('locked_ref rejects commitment-only placeholders');
	}
	const vout = Number(match[2]);
	if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff) {
		throw new Error('locked_ref vout is outside the u32 range');
	}
	return `${match[1].toLowerCase()}:${vout}`;
}

export function exactTxHashHex(hashHex: string, label: string): string {
	const normalized = hashHex.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(normalized)) {
		throw new Error(`${label} must be 32-byte hex`);
	}
	if (
		normalized === PLACEHOLDER_SETTLE ||
		normalized === PLACEHOLDER_REFUND ||
		/^0+$/.test(normalized)
	) {
		throw new Error(`${label} rejects placeholder/zero digests`);
	}
	return normalized;
}

export interface GenuineFundingRefs {
	lockedRef: string;
	txSettleHashHex: string;
	txRefundHashHex: string;
}

/** Bind settle XOR refund template digests to a funded outpoint. */
export async function fundingRefsFromTemplates(
	plan: VerifiedArkContractPlan,
	lockedRef: string
): Promise<GenuineFundingRefs & { settle: ArkSpendTemplate; refund: ArkSpendTemplate }> {
	const settle = await buildSettleTemplate(plan, lockedRef);
	const refund = await buildRefundTemplate(plan, lockedRef);
	if (settle.templateDigestHex === refund.templateDigestHex) {
		throw new Error('settle and refund digests must differ');
	}
	return {
		lockedRef: exactLockedRef(lockedRef),
		txSettleHashHex: exactTxHashHex(settle.templateDigestHex, 'tx_settle_hash'),
		txRefundHashHex: exactTxHashHex(refund.templateDigestHex, 'tx_refund_hash'),
		settle,
		refund
	};
}

export type AssembleProviderMaterialInput = {
	orderId: Uint8Array;
	providerFp: Uint8Array;
	providerPgpPubkey: Uint8Array;
	providerMusig2Pubkey: string;
	settleNoncePub: string;
	refundNoncePub: string;
	providerCancelPubkeyHex: string;
	funding: GenuineFundingRefs;
};

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build wire ProviderMaterial; fails closed on placeholders. */
export function assembleProviderMaterial(input: AssembleProviderMaterialInput): WireProviderMaterial {
	if (input.orderId.length !== 16) throw new Error('order_id must be 16 bytes');
	if (input.providerFp.length !== 20) throw new Error('provider_fp must be 20 bytes');
	const funding: GenuineFundingRefs = {
		lockedRef: exactLockedRef(input.funding.lockedRef),
		txSettleHashHex: exactTxHashHex(input.funding.txSettleHashHex, 'tx_settle_hash'),
		txRefundHashHex: exactTxHashHex(input.funding.txRefundHashHex, 'tx_refund_hash')
	};
	if (funding.txSettleHashHex === funding.txRefundHashHex) {
		throw new Error('settle and refund hashes must differ (XOR)');
	}
	if (!/^[0-9a-f]{66}$/i.test(input.providerMusig2Pubkey)) {
		throw new Error('provider_musig2_pubkey must be 33-byte compressed hex');
	}
	if (!/^[0-9a-f]{132}$/i.test(input.settleNoncePub) || !/^[0-9a-f]{132}$/i.test(input.refundNoncePub)) {
		throw new Error('MuSig2 pub-nonces must be 66-byte hex');
	}
	return {
		order_id: input.orderId.slice(),
		provider_fp: input.providerFp.slice(),
		provider_pgp_pubkey: input.providerPgpPubkey.slice(),
		provider_musig2_pubkey: input.providerMusig2Pubkey.toLowerCase(),
		settle_nonce_pub: input.settleNoncePub.toLowerCase(),
		refund_nonce_pub: input.refundNoncePub.toLowerCase(),
		provider_cancel_pubkey_hex: input.providerCancelPubkeyHex.toLowerCase(),
		locked_ref: funding.lockedRef,
		tx_settle_hash_hex: funding.txSettleHashHex,
		tx_refund_hash_hex: funding.txRefundHashHex
	};
}

/** Debug helper — never log secrets; only public wire fields. */
export function providerMaterialSummary(m: WireProviderMaterial): string {
	return [
		`locked_ref=${m.locked_ref}`,
		`settle=${m.tx_settle_hash_hex.slice(0, 12)}…`,
		`refund=${m.tx_refund_hash_hex.slice(0, 12)}…`,
		`provider_fp=${bytesToHex(m.provider_fp)}`
	].join(' ');
}
