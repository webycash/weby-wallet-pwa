// Production market list + pair helpers (split out of the former mock-data.ts;
// audit M8). Pair *policy* (allowed/blocked) is enforced in pair-policy.ts.

import type { AssetClass } from './pair-policy';
import type { TradingPair } from './types';

/** Pairs the exchange surfaces in the markets list. */
export const MARKET_PAIRS: TradingPair[] = [
	{ base: 'BitcoinArk', quote: 'Webcash' },
	{ base: 'Rgb20', quote: 'BitcoinArk' },
	{ base: 'Rgb21', quote: 'BitcoinArk' },
	{ base: 'Rgb20', quote: 'Webcash' },
	// Intentionally include a BLOCKED pair so the UI can demonstrate the gate.
	{ base: 'Webcash', quote: 'Voucher' }
];

export const pairKey = (p: TradingPair): string => `${p.base}/${p.quote}`;

export const assetClassesOf = (p: TradingPair): [AssetClass, AssetClass] => [p.base, p.quote];
