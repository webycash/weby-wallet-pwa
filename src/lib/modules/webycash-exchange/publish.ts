// Publish-order flow: discover/mock active seeders, compute the 0.1%
// publication fee, split it equally, pay each seeder over an allowed rail
// (Webcash or Bitcoin ARK only) through the extro facade SimplePay primitive,
// and attach the receipts.
//
// This module orchestrates the EXISTING pieces — it adds no new wire types and
// does not centralise matching. Real seeder discovery (from the torrent swarm)
// and real order-publication into the orderbook torrent are DEFERRED; the fee
// computation, rail enforcement, and receipt attachment are real.

import { newRequestId, type ExtroCommand } from '$lib/extro/commands';
import type { ExtroClient } from '$lib/extro/client';
import { computePublicationFee, isAllowedFeeRail } from './publication-fee';
import { hexToBytes } from './push-hooks';
import type { FeeShare, PublicationFee, Seeder } from './types';

export interface PublishInput {
	/** Order value in atomic quote units, used to size the 0.1% fee. */
	orderValue: number;
	/** Active (and inactive) seeders discovered for this order's chunks. */
	seeders: readonly Seeder[];
	/** Wallet identity slot whose key signs each fee payment. */
	slot: number;
	/** Asset tag for the fee rail payment. */
	feeAsset?: string;
}

export type PublishResult =
	| { ok: true; fee: PublicationFee; shares: FeeShare[] }
	| { ok: false; reason: 'no-active-seeders' | 'unsupported-fee-rail' | 'payment-failed'; fee: PublicationFee };

/** Map a fee rail onto the wire-form scheme extro-node expects for SimplePay. */
const railToScheme = (rail: FeeShare['rail']): string =>
	rail === 'bitcoin_ark' ? 'bitcoin_ark' : 'webcash';

/**
 * Run the publish-fee flow. Computes the split, then pays each share via
 * `Scheme402Command::SimplePay` through the single-flight facade, collecting a
 * receipt id per share. Returns `ok:false` (without paying anyone) when the fee
 * plan is blocked.
 */
export async function publishOrderFee(
	client: ExtroClient,
	input: PublishInput
): Promise<PublishResult> {
	const fee = computePublicationFee(input.orderValue, input.seeders);
	if (!fee.allowed) {
		return { ok: false, reason: fee.blockedReason ?? 'no-active-seeders', fee };
	}

	const paid: FeeShare[] = [];
	for (const share of fee.shares) {
		// Defence in depth: never pay over a disallowed rail even if a share
		// somehow carried one.
		if (!isAllowedFeeRail(share.rail)) {
			return { ok: false, reason: 'unsupported-fee-rail', fee };
		}
		const command = mkSimplePay(input.slot, share, input.feeAsset ?? 'fee');
		const response = await client.send(command);
		if (response.kind === 'Err' || response.body.kind !== 'SignedRetry') {
			return { ok: false, reason: 'payment-failed', fee };
		}
		paid.push({ ...share, receiptId: bytesToHex(response.body.receipt_id) });
	}

	return { ok: true, fee, shares: paid };
}

const mkSimplePay = (slot: number, share: FeeShare, asset: string): ExtroCommand => ({
	request_id: newRequestId(),
	op: {
		kind: 'Scheme402',
		cmd: {
			op: 'SimplePay',
			slot,
			scheme: railToScheme(share.rail),
			amount_raw: BigInt(Math.max(0, Math.trunc(share.amount))),
			asset,
			pay_to: hexToBytes(share.seederFingerprint, 20),
			idempotency: newRequestId(),
			inner: new Uint8Array(0)
		}
	}
});

function bytesToHex(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += x.toString(16).padStart(2, '0');
	return s;
}
