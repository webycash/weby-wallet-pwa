/**
 * Maker-side responder. Polls the directed swap inbox for this wallet's OWN
 * live orders; when a taker's signed Accept arrives it runs the maker side of
 * runSwap as far as genuine material allows:
 *   1. derive REAL per-swap MuSig2 provider material inside the WASM
 *      (Scheme402 ProviderMaterial — the key never leaves the WASM, and the call
 *      fails closed while the wallet is locked);
 *   2. send ProviderMaterial to the taker — which requires a genuinely funded
 *      2-of-2 VTXO (`locked_ref`) + settle/refund hashes. Without them it stops
 *      at the exact named gate; nothing is fabricated.
 */
import { getExtroClient } from '$lib/extro';
import { newRequestId } from '@extro/node';
import { fetchSwapMsgs, probeProviderMaterial } from './accept-run-swap';
import type { LimitOrder } from './types';
import { makerRole, runSwapRole, type SwapPhase, type SwapProgress, type SwapRole } from './ark-swap-protocol';
import { defaultSettleTransport } from './ark-settle-transport';

export type MakerResponse = {
	orderId: string;
	takerFp: string;
	phase: 'accept-received' | 'material-derived' | 'stopped' | 'sent' | 'error' | SwapPhase;
	role?: SwapRole;
	contractAddress?: string;
	providerPubkey?: string;
	gate?: string;
	message: string;
	at: number;
};

const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Poll once; returns Accepts that are new (not in `seen`). */
export async function pollAcceptsForOwnOrders(
	own: readonly LimitOrder[],
	seen: ReadonlySet<string>
): Promise<{ order: LimitOrder; takerFp: string }[]> {
	const out: { order: LimitOrder; takerFp: string }[] = [];
	for (const order of own) {
		try {
			const msgs = await fetchSwapMsgs(order.id);
			const acc = msgs.accept as { bearer_seller_fp?: Uint8Array } | null;
			if (!acc?.bearer_seller_fp) continue;
			const takerFp = bytesToHex(acc.bearer_seller_fp);
			const key = `${order.id}:${takerFp}`;
			if (!seen.has(key)) out.push({ order, takerFp });
		} catch {
			/* transient (locked / node busy): next poll retries */
		}
	}
	return out;
}

/** Run the maker side for one Accept. */
export async function respondToAccept(
	order: LimitOrder,
	takerFp: string,
	slot = 0
): Promise<MakerResponse> {
	const base = { orderId: order.id, takerFp, at: Date.now() };
	try {
		const mat = await getExtroClient().send({
			request_id: newRequestId(),
			op: { kind: 'Scheme402', cmd: { op: 'ProviderMaterial', slot, swap_id: order.id } }
		});
		if (mat.kind === 'Err') {
			return { ...base, phase: 'error', message: `ProviderMaterial: ${mat.message}` };
		}
		const providerPubkey =
			mat.body.kind === 'ProviderMaterial' ? mat.body.musig2_pubkey : undefined;
		// No funded 2-of-2 VTXO exists for this order in the browser wallet, so no
		// genuine locked_ref/settle/refund hashes: stop at the named gate.
		const probe = await probeProviderMaterial(order, takerFp, slot, undefined);
		if (!probe.ok) {
			return { ...base, phase: 'stopped', providerPubkey, gate: probe.gate, message: probe.message };
		}
		return { ...base, phase: 'sent', providerPubkey, message: 'ProviderMaterial sent to taker' };
	} catch (e) {
		return { ...base, phase: 'error', message: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Ark-enabled maker side: run this wallet's role (provider or bearer seller,
 * decided by the order side) through offer → terms → contract → funding gate.
 */
export async function runMakerSwap(
	order: LimitOrder,
	takerFp: string,
	onUpdate: (r: MakerResponse) => void,
	slot = 0
): Promise<MakerResponse> {
	const role = makerRole(order);
	const toResponse = (p: SwapProgress): MakerResponse => ({
		orderId: order.id,
		takerFp,
		role,
		phase: p.phase,
		gate: p.gate,
		contractAddress: p.contractAddress,
		message: `${role}: ${p.message}`,
		at: Date.now()
	});
	const final = await runSwapRole(role, order, takerFp, {
		slot,
		settleTransport: defaultSettleTransport(),
		onProgress: (p) => onUpdate(toResponse(p))
	});
	return toResponse(final);
}
