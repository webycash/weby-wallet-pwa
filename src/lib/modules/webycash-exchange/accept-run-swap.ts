/**
 * Step 7 orchestration: DHTX order → SendSwapAccept → await ProviderMaterial →
 * (prepare) → runSwap.
 *
 * With `ark_enabled=false`, this path MUST reach the runSwap boundary and stop
 * at ARK_DISABLED — never invent a settled terminal phase. When Ark is enabled,
 * the taker awaits genuine maker ProviderMaterial (locked_ref + settle/refund
 * hashes) from the DHTX swap inbox before calling runSwap.
 */

import { getExtroClient } from '$lib/extro';
import { newRequestId, type WireProviderMaterial } from '$lib/extro/commands';
import { getRuntimeConfig } from '$lib/extro/runtime-config';
import {
	GATE_ARK_DISABLED,
	GATE_PROVIDER_MATERIAL_UNSUPPORTED,
	GATE_RUNSWAP_NEED_PREPARE,
	GATE_RUNSWAP_STOPPED_NO_PROVIDER,
	NamedArkGateError
} from '$lib/ark/named-gates';
import { openTrade, runSwap, trades, type RunSwapInput } from './trade-store.svelte';
import type { SwapProgress } from './swap-runner';
import { evaluatePair } from './pair-policy';
import type { ProviderMaterial } from './swap-facts';
import type { LimitOrder, Trade } from './types';

const hexToBytes = (hex: string, length: number, name: string): Uint8Array => {
	if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, 'i').test(hex)) {
		throw new Error(`${name} must be exactly ${length} bytes hex`);
	}
	return Uint8Array.from({ length }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export type AcceptRunSwapStage =
	| 'idle'
	| 'accepting'
	| 'accepted'
	| 'probing-provider'
	| 'awaiting-provider'
	| 'provider-ready'
	| 'preparing'
	| 'runswap-entered'
	| 'stopped';

export interface AcceptRunSwapProgress {
	stage: AcceptRunSwapStage;
	orderId: string;
	/** Named gate when stopped before settlement. */
	gate?: string;
	error?: string;
	trade?: Trade | null;
	/** Latest in-browser runner progress (proving → advancing → settled/failed). */
	swapProgress?: SwapProgress;
	/** True only when executeSwap/runSwap was invoked (even if it then failed). */
	reachedRunSwap: boolean;
	/** Public ProviderMaterial received over DHTX (taker) when available. */
	provider?: WireProviderMaterial | null;
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

/** Drain DHTX and return Accept + ProviderMaterial for an order (pull-on-drain). */
export async function fetchSwapMsgs(orderIdHex: string): Promise<{
	accept: unknown | null;
	provider: WireProviderMaterial | null;
}> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: { op: 'FetchSwapMsgs', order_id: hexToBytes(orderIdHex, 16, 'order id') }
		}
	});
	if (response.kind === 'Err') throw new Error(`FetchSwapMsgs: ${response.message}`);
	if (response.body.kind !== 'SwapMsgs') {
		throw new Error(`FetchSwapMsgs: unexpected ${response.body.kind}`);
	}
	return {
		accept: response.body.accept ?? null,
		provider: response.body.provider ?? null
	};
}

export type AwaitProviderMaterialOpts = {
	/** Max wall-clock wait for maker ProviderMaterial (default 30s). */
	timeoutMs?: number;
	/** Poll interval (default 250ms). */
	intervalMs?: number;
};

/** Poll the swap inbox until the maker's ProviderMaterial arrives (or timeout). */
export async function awaitProviderMaterial(
	orderIdHex: string,
	opts: AwaitProviderMaterialOpts = {}
): Promise<WireProviderMaterial | null> {
	const timeoutMs = opts.timeoutMs ?? 30_000;
	const intervalMs = opts.intervalMs ?? 250;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { provider } = await fetchSwapMsgs(orderIdHex);
		if (provider?.locked_ref && provider.tx_settle_hash_hex && provider.tx_refund_hash_hex) {
			return provider;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return null;
}

/**
 * Convert wire ProviderMaterial (+ optional conditional payload) into the
 * runSwap ProviderMaterial shape. Fails closed on placeholder locked_ref/hashes.
 */
export function providerMaterialFromWire(
	wire: WireProviderMaterial,
	conditionalPayload: Uint8Array
): ProviderMaterial {
	const locked = wire.locked_ref.trim();
	if (!/^([0-9a-f]{64}):(\d+)$/i.test(locked) || /^v+:/i.test(locked)) {
		throw new Error('provider locked_ref must be a real Ark VTXO outpoint');
	}
	const settle = wire.tx_settle_hash_hex.toLowerCase();
	const refund = wire.tx_refund_hash_hex.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(settle) || !/^[0-9a-f]{64}$/.test(refund)) {
		throw new Error('provider settle/refund hashes must be 32-byte hex');
	}
	if (settle === 'ab'.repeat(32) || refund === 'cf'.repeat(32) || settle === refund) {
		throw new Error('provider settle/refund hashes reject placeholders / XOR collision');
	}
	if (!(conditionalPayload instanceof Uint8Array) || conditionalPayload.length !== 128) {
		throw new Error('conditional_payload must be exactly 128 bytes');
	}
	return {
		musig2_pubkey: wire.provider_musig2_pubkey.toLowerCase(),
		settle_nonce: wire.settle_nonce_pub.toLowerCase(),
		refund_nonce: wire.refund_nonce_pub.toLowerCase(),
		provider_fp: bytesToHex(wire.provider_fp),
		provider_pgp_pubkey: bytesToHex(wire.provider_pgp_pubkey),
		provider_cancel_pubkey_hex: wire.provider_cancel_pubkey_hex.toLowerCase(),
		locked_ref: locked.toLowerCase(),
		tx_settle_hash_hex: settle,
		tx_refund_hash_hex: refund,
		conditional_payload: conditionalPayload.slice()
	};
}

export type AttemptAcceptRunSwapInput = {
	order: LimitOrder;
	/** Optional full runSwap input once ProviderMaterial + prepare exist. */
	runSwapInput?: RunSwapInput;
	takerFingerprintHex?: string;
	/** Genuine Ark funding refs required to pass SendProviderMaterial (maker). */
	providerFunding?: ProbeProviderMaterialFunding;
	/**
	 * When true (default if ark_enabled and no runSwapInput/providerFunding),
	 * poll DHTX for maker ProviderMaterial after Accept.
	 */
	awaitProvider?: boolean;
	awaitProviderOpts?: AwaitProviderMaterialOpts;
	/**
	 * When ProviderMaterial is present and runSwapInput was not supplied, invoke
	 * this builder to assemble dual-signed prepare + RunSwapInput. Returning a
	 * RunSwapInput closes RUNSWAP_NEED_PREPARE and enters prove.
	 */
	buildRunSwapInput?: (
		provider: WireProviderMaterial,
		order: LimitOrder
	) => Promise<RunSwapInput>;
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
	const {
		order,
		runSwapInput,
		takerFingerprintHex,
		providerFunding,
		awaitProvider,
		awaitProviderOpts,
		buildRunSwapInput,
		slot = 0,
		onProgress
	} = input;
	const emit = (p: AcceptRunSwapProgress) => onProgress?.(p);

	let progress: AcceptRunSwapProgress = {
		stage: 'accepting',
		orderId: order.id,
		reachedRunSwap: false,
		provider: null
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
				error: GATE_ARK_DISABLED,
				provider: null
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

		// Maker path: push genuine funding refs as ProviderMaterial.
		if (takerFingerprintHex && providerFunding) {
			progress = { ...progress, stage: 'probing-provider' };
			emit(progress);
			const probe = await probeProviderMaterial(order, takerFingerprintHex, slot, providerFunding);
			if (!probe.ok) {
				progress = {
					stage: 'stopped',
					orderId: order.id,
					gate: probe.gate,
					reachedRunSwap: false,
					error: probe.message,
					provider: null
				};
				emit(progress);
				return progress;
			}
		}

		// Taker path: await maker ProviderMaterial from DHTX inbox.
		const shouldAwait =
			awaitProvider === true ||
			(awaitProvider !== false && !runSwapInput && !providerFunding);
		let wireProvider: WireProviderMaterial | null = null;
		if (shouldAwait || (runSwapInput && awaitProvider !== false)) {
			progress = { ...progress, stage: 'awaiting-provider' };
			emit(progress);
			wireProvider = await awaitProviderMaterial(order.id, awaitProviderOpts);
			progress = {
				...progress,
				stage: wireProvider ? 'provider-ready' : progress.stage,
				provider: wireProvider
			};
			emit(progress);
		}

		if (runSwapInput) {
			// If caller supplied RunSwapInput, prefer DHTX provider locked_ref when present
			// (fail closed if it disagrees with a non-matching input provider).
			if (wireProvider) {
				const inputLocked = runSwapInput.provider?.locked_ref?.toLowerCase?.();
				const wireLocked = wireProvider.locked_ref.toLowerCase();
				if (inputLocked && inputLocked !== wireLocked) {
					throw new Error(
						`ProviderMaterial locked_ref mismatch: DHTX=${wireLocked} runSwapInput=${inputLocked}`
					);
				}
			}
			return await attemptRunSwapBoundary(runSwapInput, order.id, onProgress, wireProvider);
		}

		if (wireProvider) {
			if (buildRunSwapInput) {
				progress = {
					...progress,
					stage: 'preparing',
					provider: wireProvider
				};
				emit(progress);
				const built = await buildRunSwapInput(wireProvider, order);
				return await attemptRunSwapBoundary(built, order.id, onProgress, wireProvider);
			}
			progress = {
				stage: 'stopped',
				orderId: order.id,
				gate: GATE_RUNSWAP_NEED_PREPARE,
				reachedRunSwap: true,
				error: GATE_RUNSWAP_NEED_PREPARE,
				provider: wireProvider
			};
			emit(progress);
			return progress;
		}

		return await attemptRunSwapBoundary(undefined, order.id, onProgress, null);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		const gate = e instanceof NamedArkGateError ? e.gate : error;
		progress = {
			stage: 'stopped',
			orderId: order.id,
			gate,
			error,
			reachedRunSwap: progress.reachedRunSwap,
			provider: progress.provider ?? null
		};
		emit(progress);
		return progress;
	}
}

/**
 * Explicit runSwap boundary. Without full prepare/ProviderMaterial inputs,
 * records that the UI reached the runner and stops at the named gate.
 * When runSwapInput is supplied, NO_PROVIDER is never returned — failures
 * surface the real runner/phase error instead.
 */
export async function attemptRunSwapBoundary(
	runSwapInput?: RunSwapInput,
	orderId = '',
	onProgress?: (p: AcceptRunSwapProgress) => void,
	provider: WireProviderMaterial | null = null
): Promise<AcceptRunSwapProgress> {
	if (runSwapInput) {
		onProgress?.({
			stage: 'runswap-entered',
			orderId: orderId || runSwapInput.order.id,
			reachedRunSwap: true,
			provider
		});
		try {
			const trade = await runSwap(runSwapInput);
			const progress = trades.swapProgress;
			const settled = trade?.phase === 'settled' || trade?.phase === 'completed';
			const refunded = trade?.phase === 'refunded';
			if (settled || refunded) {
				const ok: AcceptRunSwapProgress = {
					stage: 'runswap-entered',
					orderId: orderId || runSwapInput.order.id,
					reachedRunSwap: true,
					trade,
					swapProgress: progress,
					provider
				};
				onProgress?.(ok);
				return ok;
			}
			// Prefer the runner's real failure stage/error over a blank PHASE_unknown.
			const runnerErr = progress?.error?.trim();
			const phaseLabel = trade?.phase ?? (progress?.phase || null);
			const gate = runnerErr
				? `RUNSWAP_${(progress?.stage ?? 'failed').toUpperCase().replace(/-/g, '_')}: ${runnerErr}`
				: `RUNSWAP_PHASE_${phaseLabel ?? 'unknown'}`;
			const error = runnerErr
				? runnerErr
				: `runSwap ended in phase=${phaseLabel ?? 'null'} (stage=${progress?.stage ?? 'idle'})`;
			const stopped: AcceptRunSwapProgress = {
				stage: 'stopped',
				orderId: orderId || runSwapInput.order.id,
				reachedRunSwap: true,
				trade,
				swapProgress: progress,
				provider,
				gate,
				error
			};
			onProgress?.(stopped);
			return stopped;
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			const gate = e instanceof NamedArkGateError ? e.gate : `RUNSWAP_ERROR: ${error}`;
			const stopped: AcceptRunSwapProgress = {
				stage: 'stopped',
				orderId: orderId || runSwapInput.order.id,
				reachedRunSwap: true,
				provider,
				swapProgress: trades.swapProgress,
				gate,
				error
			};
			onProgress?.(stopped);
			return stopped;
		}
	}

	const stopped: AcceptRunSwapProgress = {
		stage: 'stopped',
		orderId,
		reachedRunSwap: true,
		provider,
		gate: provider ? GATE_RUNSWAP_NEED_PREPARE : GATE_RUNSWAP_STOPPED_NO_PROVIDER,
		error: provider ? GATE_RUNSWAP_NEED_PREPARE : GATE_RUNSWAP_STOPPED_NO_PROVIDER
	};
	onProgress?.(stopped);
	return stopped;
}
