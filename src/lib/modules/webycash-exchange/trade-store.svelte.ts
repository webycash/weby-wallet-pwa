// Trade reactive store — a THIN wrapper over `trade-timeline` (pure) and the
// referee client (mock by default). Holds the list of trades as runes; the
// state-machine logic is unit-tested in `trade-timeline.test.ts`.
//
// SECRECY: a Trade holds public commitments + redaction-safe timeline notes
// only.

import {
	driveToTerminal,
	newTrade,
	applyPhase,
	phaseFromReferee,
	cancelTrade,
	type NewTradeInput
} from './trade-timeline';
import { MockRefereeClient, type RefereeClient } from './referee-client';
import { executeSwap, type SwapProgress, type ExecuteSwapInput } from './swap-runner';
import { evaluatePair } from './pair-policy';
import type { Trade } from './types';

interface TradeState {
	trades: Trade[];
	selectedSwapId: string | null;
	/** Progress of the in-flight `runSwap` (proving → … → settled/failed). */
	swapProgress: SwapProgress;
}

const state = $state<TradeState>({
	trades: [],
	selectedSwapId: null,
	swapProgress: { stage: 'idle' }
});

// Default to a mock referee that drives any swap straight to settled. A real
// HttpRefereeClient can be injected via `setReferee` once endpoints are live.
let referee: RefereeClient = new MockRefereeClient();

export function setReferee(client: RefereeClient): void {
	referee = client;
}

export const trades = {
	get all(): Trade[] {
		return state.trades;
	},
	get active(): Trade[] {
		return state.trades.filter(
			(t) => !['settled', 'refunded', 'failed', 'canceled'].includes(t.phase)
		);
	},
	get selected(): Trade | null {
		return state.trades.find((t) => t.swapId === state.selectedSwapId) ?? null;
	},
	/** Progress of the most recent/in-flight `runSwap`. */
	get swapProgress(): SwapProgress {
		return state.swapProgress;
	}
};

export function selectTrade(swapId: string | null): void {
	state.selectedSwapId = swapId;
}

/** Open a new trade in `order-selected` and select it. */
export function openTrade(input: NewTradeInput): Trade {
	const trade = newTrade(input);
	state.trades = [trade, ...state.trades];
	state.selectedSwapId = trade.swapId;
	return trade;
}

const replace = (next: Trade) => {
	state.trades = state.trades.map((t) => (t.swapId === next.swapId ? next : t));
};

/**
 * Drive the selected (or given) trade to a terminal state via the referee,
 * updating the store as it progresses.
 */
export async function settleTrade(swapId: string): Promise<Trade | null> {
	const trade = state.trades.find((t) => t.swapId === swapId);
	if (!trade) return null;
	const final = await driveToTerminal(trade, referee);
	replace(final);
	return final;
}

export function cancel(swapId: string): void {
	const trade = state.trades.find((t) => t.swapId === swapId);
	if (!trade) return;
	replace(cancelTrade(trade, Math.floor(Date.now() / 1000)));
}

// ── Real in-browser swap (proving → initiate → advance) ───────────────────────

const nowSec = () => Math.floor(Date.now() / 1000);

export interface RunSwapInput extends Omit<ExecuteSwapInput, 'referee' | 'onProgress'> {
	/** Override the store's referee (defaults to the injected one). */
	referee?: RefereeClient;
}

/**
 * Run the REAL in-browser swap-initiate path for a selected order: prove
 * off-thread, POST the envelope to the referee, and drive a local Trade to a
 * terminal phase. Progress is surfaced via `trades.swapProgress`; the referee's
 * reported phases are applied to the Trade timeline as they arrive.
 *
 * Returns the settled/failed Trade (or null if the runner threw before a swap id
 * was assigned).
 */
export async function runSwap(input: RunSwapInput): Promise<Trade | null> {
	const client = input.referee ?? referee;
	const order = input.order;
	const verdict = evaluatePair(order.pair.base, order.pair.quote);

	let trade: Trade | null = null;

	const ensureTrade = (swapId: string, phase: string): Trade => {
		const existing = state.trades.find((t) => t.swapId === swapId);
		if (existing) return existing;
		const opened = newTrade({
			swapId,
			pair: order.pair,
			side: order.side,
			amount: order.amount,
			price: order.price,
			settlementModel: verdict.settlementModel,
			requiresReferee: verdict.requiresReferee
		});
		const seeded = applyPhase(opened, phaseFromReferee(phase), nowSec());
		state.trades = [seeded, ...state.trades];
		state.selectedSwapId = swapId;
		return seeded;
	};

	const onProgress = (p: SwapProgress) => {
		state.swapProgress = p;
		if (p.swapId && p.phase) {
			trade = ensureTrade(p.swapId, p.phase);
			const advanced = applyPhase(trade, phaseFromReferee(p.phase), nowSec());
			replace(advanced);
			trade = advanced;
		}
	};

	try {
		await executeSwap({ ...input, referee: client, onProgress });
		return trade;
	} catch {
		// The `failed` progress is already surfaced via onProgress/swapProgress.
		return trade;
	}
}
