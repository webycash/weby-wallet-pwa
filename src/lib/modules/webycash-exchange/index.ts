// Webycash exchange module — public surface.
//
// Built ON TOP of extro-node + extro-402-scheme via the `$lib/extro` facade.
// This module owns the Webycash DEX/orderbook behaviour; it does NOT implement
// generic Extro wire types (those are called through the facade) nor the
// referee state machine (that is `webycash-referee`).

export * from './types';
export * from './pair-policy';
export * from './book-math';
export * from './publication-fee';
export * from './publish';
export * from './push-hooks';
export * from './referee-client';
export * from './trade-timeline';
export * from './swap-facts';
export * from './swap-runner';
export * from './mock-data';

// Reactive stores (Svelte 5 runes — import where a component needs them).
export {
	orderbook,
	selectPair,
	refreshBook,
	publishOrder,
	walkCurrent,
	pairLabel,
	assetClasses
} from './orderbook-store.svelte';
export {
	trades,
	openTrade,
	settleTrade,
	runSwap,
	selectTrade,
	cancel as cancelTradeAction,
	setReferee
} from './trade-store.svelte';
