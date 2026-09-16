/**
 * Step 7 orchestration: DHTX order → SendSwapAccept → (prepare) → runSwap.
 *
 * With `ark_enabled=false`, this path MUST reach the runSwap boundary and stop
 * at ARK_DISABLED — never invent a settled terminal phase. When Ark is enabled,
 * SendProviderMaterial requires genuine locked_ref + settle/refund hashes.
 */

import { getExtroClient } from '$lib/extro';
import { newRequestId } from '$lib/extro/commands';
import { getRuntimeConfig } from '$lib/extro/runtime-config';
import {
	GATE_ARK_DISABLED,
	GATE_PROVIDER_MATERIAL_UNSUPPORTED,
	GATE_RUNSWAP_STOPPED_NO_PROVIDER,
	NamedArkGateError
} from '$lib/ark/named-gates';
import { openTrade, runSwap, type RunSwapInput } from './trade-store.svelte';
import { evaluatePair } from './pair-policy';
import type { LimitOrder, Trade } from './types';

const hexToBytes = (hex: string, length: number, name: string): Uint8Array => {
	if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, 'i').test(hex)) {
		throw new Error(`${name} must be exactly ${length} bytes hex`);
	}
	return Uint8Array.from({ length }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};

export type AcceptRunSwapStage =
	| 'idle'
	| 'accepting'
	| 'accepted'
	| 'probing-provider'
	| 'runswap-entered'
	| 'stopped';

export interface AcceptRunSwapProgress {
	stage: AcceptRunSwapStage;
	orderId: string;
	/** Named gate when stopped before settlement. */
	gate?: string;
	error?: string;
	trade?: Trade | null;
	/** True only when executeSwap/runSwap was invoked (even if it then failed). */
	reachedRunSwap: boolean;
}

export interface AcceptNetworkOrderResult {
	orderId: string;
	delivered: boolean;
}

/** Send authenticated Accept for a DHTX-discovered order (no local fake trade id). */
export async function acceptNetworkOrder(
	order: LimitOrder,
	slot = 0
): Promise<AcceptNetworkOrderResult> {
	if (order.source !== 'dhtx' && order.source !== 'peer') {
		throw new Error(`acceptNetworkOrder requires a network order, got source=${order.source}`);
	}
	const orderId = hexToBytes(order.id, 16, 'order id');
	const makerFp = hexToBytes(order.makerFingerprint, 20, 'maker fingerprint');
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: { op: 'SendSwapAccept', slot, order_id: orderId, maker_fp: makerFp }
		}
	});
	if (response.kind === 'Err') throw new Error(`SendSwapAccept: ${response.message}`);
	if (response.body.kind !== 'SwapMsgSent') {
		throw new Error(`SendSwapAccept: unexpected ${response.body.kind}`);
	}
	return { orderId: order.id, delivered: response.body.delivered };
}

/**
 * Probe SendProviderMaterial. Without funding refs → PROVIDER_MATERIAL_UNSUPPORTED.
 * With genuine locked_ref + hashes the WASM path may deliver; placeholders fail closed.
 */
export type ProbeProviderMaterialFunding = {
	lockedRef: string;
	txSettleHashHex: string;
	txRefundHashHex: string;
};

export async function probeProviderMaterial(
	order: LimitOrder,
	takerFpHex: string,
	slot = 0,
	funding?: ProbeProviderMaterialFunding
): Promise<{ ok: false; gate: string; message: string } | { ok: true }> {
	if (!funding) {
		return {
			ok: false,
			gate: GATE_PROVIDER_MATERIAL_UNSUPPORTED,
			message: GATE_PROVIDER_MATERIAL_UNSUPPORTED
		};
	}
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: {
				op: 'SendProviderMaterial',
				slot,
				order_id: hexToBytes(order.id, 16, 'order id'),
				taker_fp: hexToBytes(takerFpHex, 20, 'taker fingerprint'),
				locked_ref: funding.lockedRef,
				tx_settle_hash_hex: funding.txSettleHashHex,
				tx_refund_hash_hex: funding.txRefundHashHex
			}
		}
	});
	if (response.kind === 'Err') {
		const message = response.message;
		const gate =
			message.includes('genuine locked_ref') || response.code === 'Unsupported'
				? GATE_PROVIDER_MATERIAL_UNSUPPORTED
				: `PROVIDER_MATERIAL_ERROR: ${response.code}: ${message}`;
		return { ok: false, gate, message };
	}
	// A successful send without Gate 3 funding evidence must not be treated as pass.
	return { ok: true };
}

export type AttemptAcceptRunSwapInput = {
	order: LimitOrder;
	/** Optional full runSwap input once ProviderMaterial + prepare exist. */
	runSwapInput?: RunSwapInput;
	takerFingerprintHex?: string;
	/** Genuine Ark funding refs required to pass SendProviderMaterial. */
	providerFunding?: ProbeProviderMaterialFunding;
	slot?: number;
	onProgress?: (p: AcceptRunSwapProgress) => void;
};

/**
 * UI entry: Accept a network order, open a Trade bound to that order id, then
 * either call runSwap with real inputs or stop at a named Ark/Provider gate.
 */
export async function attemptAcceptAndRunSwap(
	input: AttemptAcceptRunSwapInput
): Promise<AcceptRunSwapProgress> {
	const { order, runSwapInput, takerFingerprintHex, providerFunding, slot = 0, onProgress } = input;
	const emit = (p: AcceptRunSwapProgress) => onProgress?.(p);

	let progress: AcceptRunSwapProgress = {
		stage: 'accepting',
		orderId: order.id,
		reachedRunSwap: false
	};
	emit(progress);

	try {
		let arkEnabled = false;
		try {
			arkEnabled = getRuntimeConfig().ark_enabled;
		} catch {
			arkEnabled = false;
		}
		if (!arkEnabled) {
			// Still Accept so the DHTX path is exercised.
			await acceptNetworkOrder(order, slot);
			const verdict = evaluatePair(order.pair.base, order.pair.quote);
			const trade = openTrade({
				swapId: order.id,
				pair: order.pair,
				side: order.side === 'sell' ? 'buy' : 'sell',
				amount: order.amount,
				price: order.price,
				settlementModel: verdict.settlementModel,
				requiresReferee: verdict.requiresReferee
			});
			// Hit the runSwap boundary for evidence, then stop at ARK_DISABLED.
			const boundary = await attemptRunSwapBoundary(runSwapInput, order.id);
			progress = {
				stage: 'stopped',
				orderId: order.id,
				gate: GATE_ARK_DISABLED,
				trade,
				reachedRunSwap: true,
				error: GATE_ARK_DISABLED
			};
			if (boundary.gate && runSwapInput) {
				progress.gate = boundary.gate;
				progress.error = boundary.error ?? boundary.gate;
			}
			emit(progress);
			return progress;
		}

		await acceptNetworkOrder(order, slot);
		progress = { ...progress, stage: 'accepted' };
		emit(progress);

		if (takerFingerprintHex) {
			progress = { ...progress, stage: 'probing-provider' };
			emit(progress);
			const probe = await probeProviderMaterial(order, takerFingerprintHex, slot, providerFunding);
			if (!probe.ok) {
				progress = {
					stage: 'stopped',
					orderId: order.id,
					gate: probe.gate,
					reachedRunSwap: false,
					error: probe.message
				};
				emit(progress);
				return progress;
			}
		}

		return await attemptRunSwapBoundary(runSwapInput, order.id, onProgress);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		const gate = e instanceof NamedArkGateError ? e.gate : error;
		progress = {
			stage: 'stopped',
			orderId: order.id,
			gate,
			error,
			reachedRunSwap: progress.reachedRunSwap
		};
		emit(progress);
		return progress;
	}
}

/**
 * Explicit runSwap boundary. Without full prepare/ProviderMaterial inputs,
 * records that the UI reached the runner and stops at the named gate.
 */
export async function attemptRunSwapBoundary(
	runSwapInput?: RunSwapInput,
	orderId = '',
	onProgress?: (p: AcceptRunSwapProgress) => void
): Promise<AcceptRunSwapProgress> {
	if (runSwapInput) {
		onProgress?.({
			stage: 'runswap-entered',
			orderId: orderId || runSwapInput.order.id,
			reachedRunSwap: true
		});
		const trade = await runSwap(runSwapInput);
		return {
			stage: trade?.phase === 'settled' ? 'runswap-entered' : 'stopped',
			orderId: orderId || runSwapInput.order.id,
			reachedRunSwap: true,
			trade,
			gate: trade?.phase === 'settled' ? undefined : GATE_RUNSWAP_STOPPED_NO_PROVIDER
		};
	}

	const stopped: AcceptRunSwapProgress = {
		stage: 'stopped',
		orderId,
		reachedRunSwap: true,
		gate: GATE_RUNSWAP_STOPPED_NO_PROVIDER,
		error: GATE_RUNSWAP_STOPPED_NO_PROVIDER
	};
	onProgress?.(stopped);
	return stopped;
}
