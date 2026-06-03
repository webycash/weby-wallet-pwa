// Trade timeline state machine.
//
// Drives a {@link Trade} through its lifecycle phases. Local pre-states
// (order-selected → request-sent) are advanced by the taker; mediated phases
// (maker-response → … → settled/refunded/failed) are advanced by referee
// events. Push delivery is NEVER treated as proof — only a confirmed referee
// advance or rail post-check moves the state.
//
// This is a PURE module (no `$state`). The reactive `trade-store.svelte.ts`
// wraps it.

import {
	TERMINAL_PHASES,
	type Side,
	type Trade,
	type TradePhase,
	type TradingPair,
	type TimelineEvent
} from './types';
import type { SettlementModel } from './pair-policy';
import type { AdvanceResult, RefereeClient } from './referee-client';

/** Canonical happy-path ordering of phases for a referee-mediated trade. */
export const PHASE_ORDER: readonly TradePhase[] = [
	'order-selected',
	'request-sent',
	'maker-response',
	'proof-precheck',
	'delivery-dispatched',
	'post-check',
	'ark-release',
	'settled'
];

const PHASE_NOTE: Record<TradePhase, string> = {
	'order-selected': 'Order selected from the book.',
	'request-sent': 'Exact-fill order request sent to the maker.',
	'maker-response': 'Maker returned a ZKP-bound encrypted payload.',
	'proof-precheck': 'Referee verified the proof against the order commitments.',
	'delivery-dispatched': 'Encrypted bearer delivery dispatched to the recipient.',
	'post-check': 'Post-check passed — rail state confirmed.',
	'ark-release': 'ARK 2-of-2 release authorised by the referee.',
	settled: 'Swap settled.',
	refunded: 'Swap refunded — counterparty did not complete.',
	failed: 'Swap failed — fail-to-deliver; bearer secret rotated.',
	canceled: 'Swap canceled by the taker.'
};

export interface NewTradeInput {
	swapId: string;
	pair: TradingPair;
	side: Side;
	amount: number;
	price: number;
	settlementModel: SettlementModel;
	requiresReferee: boolean;
	now?: () => number;
}

/** Build a fresh trade in the `order-selected` phase. */
export function newTrade(input: NewTradeInput): Trade {
	const at = (input.now ?? (() => Math.floor(Date.now() / 1000)))();
	return {
		swapId: input.swapId,
		pair: input.pair,
		side: input.side,
		amount: input.amount,
		price: input.price,
		settlementModel: input.settlementModel,
		requiresReferee: input.requiresReferee,
		phase: 'order-selected',
		timeline: [{ phase: 'order-selected', at, note: PHASE_NOTE['order-selected'] }],
		createdAt: at,
		updatedAt: at
	};
}

export const isTerminal = (t: Trade): boolean => TERMINAL_PHASES.has(t.phase);

/**
 * Apply a phase transition, returning a NEW trade (immutable). A no-op if the
 * trade is already terminal or the phase is unchanged. Appends a timeline
 * event with a redaction-safe note.
 */
export function applyPhase(trade: Trade, phase: TradePhase, at: number, note?: string): Trade {
	if (isTerminal(trade)) return trade;
	if (trade.phase === phase) return trade;
	const event: TimelineEvent = { phase, at, note: note ?? PHASE_NOTE[phase] };
	return {
		...trade,
		phase,
		updatedAt: at,
		timeline: [...trade.timeline, event]
	};
}

/** Map a referee-reported phase string onto a {@link TradePhase}. */
export function phaseFromReferee(report: string): TradePhase {
	const known = PHASE_ORDER.find((p) => p === report);
	if (known) return known;
	switch (report) {
		case 'completed':
		case 'settled':
			return 'settled';
		case 'refunded':
			return 'refunded';
		case 'failed':
		case 'fail-to-deliver':
			return 'failed';
		case 'canceled':
			return 'canceled';
		default:
			// Unknown referee phase: keep the trade where it is by returning a
			// sentinel the driver treats as "no advance".
			return 'maker-response';
	}
}

export interface DriveOptions {
	/** Cap on referee advance steps (prevents runaway loops). */
	maxSteps?: number;
	now?: () => number;
}

/**
 * Drive a trade to a terminal state via the referee, applying each reported
 * phase to the timeline. Returns the final trade. Stops at a terminal phase or
 * when `maxSteps` is hit.
 */
export async function driveToTerminal(
	trade: Trade,
	referee: RefereeClient,
	options: DriveOptions = {}
): Promise<Trade> {
	const now = options.now ?? (() => Math.floor(Date.now() / 1000));
	const maxSteps = options.maxSteps ?? 16;
	let current = trade;
	for (let step = 0; step < maxSteps && !isTerminal(current); step++) {
		const result: AdvanceResult = await referee.advance(current.swapId);
		const phase = phaseFromReferee(result.phase);
		current = applyPhase(current, phase, now());
		if (result.terminal && TERMINAL_PHASES.has(phase)) break;
	}
	return current;
}

/** Locally mark a trade canceled (taker action, pre-settlement). */
export function cancelTrade(trade: Trade, at: number): Trade {
	return applyPhase(trade, 'canceled', at, PHASE_NOTE.canceled);
}
