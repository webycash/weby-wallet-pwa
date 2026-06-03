// Trade reactive store — a THIN wrapper over `trade-timeline` (pure) and the
// referee client (mock by default). Holds the list of trades as runes; the
// state-machine logic is unit-tested in `trade-timeline.test.ts`.
//
// SECRECY: a Trade holds public commitments + redaction-safe timeline notes
// only.

import {
	driveToTerminal,
	newTrade,
	cancelTrade,
	type NewTradeInput
} from './trade-timeline';
import { MockRefereeClient, type RefereeClient } from './referee-client';
import type { Trade } from './types';

interface TradeState {
	trades: Trade[];
	selectedSwapId: string | null;
}

const state = $state<TradeState>({ trades: [], selectedSwapId: null });

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
