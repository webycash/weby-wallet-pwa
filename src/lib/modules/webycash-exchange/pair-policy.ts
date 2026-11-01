// Asset-pair policy for the Webycash exchange.
//
// ADR-0007: the pair decision lives in extrolib `exchange::PairPolicy` and is
// consumed from extro-node. This module does NOT re-derive it. It reads the
// extro-node conformance table `@extro/node/vectors/pair_policy.json`, which
// extro-node's Rust tests check case-by-case against extrolib and which the
// `Op::Exchange PairPolicy` op returns verbatim (see pair-policy.parity.test.ts).
// The wallet only adds presentation: the UI settlement label, a stable reason
// and the bearer-race flag.
//
// Specs (cited by each vector case):
//   extro/docs/development/24-extro-402-scheme-and-webycash-plan.md §"Asset Model";
//   extro/docs/development/27 rows 10-14 + GAP C (bearer<->RGB = RefereeZkp);
//   extro/docs/development/25 referee step 4 ("fail closed on unknown pair").
//
// Invariants (enforced by extrolib, re-checked by the tests here):
//   * Deny by default; a pair missing from the table is blocked.
//   * Order-independent.
//   * No bearer flow is ever labelled atomic.

import pairPolicyVector from '@extro/node/vectors/pair_policy.json';
import type { ExchangeAssetFamily, ExchangeSettlementModel } from '@extro/node';
import { pairPolicyNode, type ExtroSend } from './exchange-core';

export type AssetClass = ExchangeAssetFamily;

/** UI settlement model. Never "atomic" for a bearer leg. */
export type SettlementModel =
	// Referee mediates; bearer leg is non-atomic / bounded-risk.
	| 'referee-mediated'
	// RGB HTLC or the ARK 2-of-2 contract path enforces the conditional leg.
	| 'rgb-conditional'
	// RGB-to-RGB conditional transition (extrolib RgbHtlc on both legs).
	| 'rgb-atomic'
	// The pair is not permitted at all.
	| 'blocked';

export interface PairVerdict {
	allowed: boolean;
	settlementModel: SettlementModel;
	/** extrolib `SettlementModel` as returned by extro-node. */
	nodeSettlementModel: ExchangeSettlementModel;
	/** Whether a referee is required to mediate this pair (extrolib). */
	requiresReferee: boolean;
	/** Whether the pair needs a conditional (contract-enforced) leg (extrolib). */
	requiresConditionalLeg: boolean;
	/**
	 * True when the bearer side carries irreducible race risk that the user MUST
	 * see acknowledged before confirming. Never true for `rgb-atomic`.
	 */
	bearerRaceRisk: boolean;
	/** Stable machine reason, present for both allow and deny. */
	reason: PairReason;
	/** Human-facing one-liner for the confirm surface. */
	label: string;
}

export type PairReason =
	| 'both-bearer-no-arbitrable-leg'
	| 'custom-asset-unsupported'
	| 'bearer-vs-ark-referee'
	| 'bearer-vs-rgb-referee'
	| 'rgb-vs-ark'
	| 'rgb-vs-rgb'
	| 'unknown-pair';

/** One extro-node `ExchangePairPolicy` result (snake_case, as on the wire). */
export interface NodePairPolicy {
	allowed: boolean;
	settlement_model: ExchangeSettlementModel;
	requires_referee: boolean;
	requires_conditional_leg: boolean;
}

interface VectorCase {
	base: AssetClass;
	quote: AssetClass;
	prefer_conditional: boolean;
	expected: NodePairPolicy;
}

const key = (a: string, b: string, preferConditional: boolean): string =>
	`${a}|${b}|${preferConditional ? 1 : 0}`;

const TABLE: ReadonlyMap<string, NodePairPolicy> = new Map(
	(pairPolicyVector as unknown as { cases: VectorCase[] }).cases.map((c) => [
		key(c.base, c.quote, c.prefer_conditional),
		c.expected
	])
);

const BEARER: ReadonlySet<AssetClass> = new Set<AssetClass>(['Webcash', 'Voucher']);
const RGB: ReadonlySet<AssetClass> = new Set<AssetClass>(['Rgb20', 'Rgb21']);

const isBearer = (a: AssetClass): boolean => BEARER.has(a);
const isRgb = (a: AssetClass): boolean => RGB.has(a);
const isArk = (a: AssetClass): boolean => a === 'BitcoinArk';

const deny = (reason: PairReason, label: string): PairVerdict => ({
	allowed: false,
	settlementModel: 'blocked',
	nodeSettlementModel: 'Forbidden',
	requiresReferee: false,
	requiresConditionalLeg: false,
	bearerRaceRisk: false,
	reason,
	label
});

function denyFor(a: AssetClass, b: AssetClass): PairVerdict {
	if (a === 'Custom' || b === 'Custom') {
		return deny('custom-asset-unsupported', 'Custom assets are not tradeable on this exchange.');
	}
	if (isBearer(a) && isBearer(b)) {
		return deny(
			'both-bearer-no-arbitrable-leg',
			'Both sides are bearer assets (Webcash/Voucher). No arbitrable leg exists, so this pair is blocked.'
		);
	}
	return deny('unknown-pair', 'This asset pair is not supported.');
}

/**
 * Present an extro-node pair-policy result for the UI. The allow/deny,
 * referee and conditional-leg facts come only from `node`; this adds labels.
 */
export function presentPairPolicy(a: AssetClass, b: AssetClass, node: NodePairPolicy): PairVerdict {
	if (!node.allowed || node.settlement_model === 'Forbidden') return denyFor(a, b);
	const base = {
		allowed: true,
		nodeSettlementModel: node.settlement_model,
		requiresReferee: node.requires_referee,
		requiresConditionalLeg: node.requires_conditional_leg,
		bearerRaceRisk: isBearer(a) || isBearer(b)
	};
	if (node.requires_referee && ((isBearer(a) && isArk(b)) || (isArk(a) && isBearer(b)))) {
		return {
			...base,
			settlementModel: 'referee-mediated',
			reason: 'bearer-vs-ark-referee',
			label:
				'Referee-mediated swap. The bearer leg is non-atomic and carries bounded race risk — not a cryptographically atomic swap.'
		};
	}
	if (node.requires_referee && ((isBearer(a) && isRgb(b)) || (isRgb(a) && isBearer(b)))) {
		return {
			...base,
			settlementModel: 'referee-mediated',
			reason: 'bearer-vs-rgb-referee',
			label:
				'Referee-mediated swap (referee ZK release). The RGB leg is conditional; the bearer leg is non-atomic and bounded-risk.'
		};
	}
	if ((isRgb(a) && isArk(b)) || (isArk(a) && isRgb(b))) {
		return {
			...base,
			settlementModel: 'rgb-conditional',
			reason: 'rgb-vs-ark',
			label: 'RGB/ARK conditional swap via HTLC or RGB-ARK contract path.'
		};
	}
	if (isRgb(a) && isRgb(b)) {
		return {
			...base,
			settlementModel: 'rgb-atomic',
			reason: 'rgb-vs-rgb',
			label: 'RGB-server-assisted atomic/conditional state transition.'
		};
	}
	// extrolib allowed a pair this UI has no presentation for: fail closed.
	return deny('unknown-pair', 'This asset pair is not supported.');
}

/**
 * Settlement policy for a pair, from the extro-node table (extrolib
 * `PairPolicy`). A pair missing from the table is blocked.
 */
export function evaluatePair(a: AssetClass, b: AssetClass, preferConditional = false): PairVerdict {
	const node = TABLE.get(key(a, b, preferConditional));
	return node ? presentPairPolicy(a, b, node) : denyFor(a, b);
}

/**
 * The same verdict, asked of the live extro-node (`Op::Exchange PairPolicy`).
 * Money paths (accept / run) use this; the table above serves the UI.
 */
export async function evaluatePairNode(
	send: ExtroSend,
	a: AssetClass,
	b: AssetClass,
	preferConditional = false
): Promise<PairVerdict> {
	return presentPairPolicy(a, b, await pairPolicyNode(send, a, b, preferConditional));
}

/** True iff the pair may be traded at all. */
export const isPairAllowed = (a: AssetClass, b: AssetClass): boolean => evaluatePair(a, b).allowed;

/** True iff trading the pair requires the Webycash referee. */
export const pairRequiresReferee = (a: AssetClass, b: AssetClass): boolean =>
	evaluatePair(a, b).requiresReferee;

/** Map an {@link AssetClass} to the extro-node `WireFamily` token. */
export function assetClassToWireFamily(a: AssetClass): string {
	switch (a) {
		case 'Webcash':
			return 'Webcash';
		case 'Voucher':
			return 'Voucher';
		case 'BitcoinArk':
			return 'Ark';
		case 'Rgb20':
		case 'Rgb21':
			return 'Rgb';
		case 'Custom':
			return 'Vault';
	}
}

/** Display label for an asset class (UI). */
export function assetLabel(a: AssetClass): string {
	switch (a) {
		case 'Webcash':
			return 'Webcash';
		case 'Voucher':
			return 'Voucher';
		case 'BitcoinArk':
			return 'Bitcoin ARK';
		case 'Rgb20':
			return 'RGB20';
		case 'Rgb21':
			return 'RGB21';
		case 'Custom':
			return 'Custom';
	}
}


/** Release exclusion reasons (pair-policy blocked only — RGB/voucher rails are webycash-server Workers). */
export type PairReleaseExclusion = 'pair-policy-blocked';

export type PairReleaseAvailability = {
	available: boolean;
	exclusion?: PairReleaseExclusion;
	/** Honest UI copy. RGB/voucher use webycash-server issuer-hosted rails (not full rgb-std/AluVM). */
	message: string;
};

const isRgbAsset = (a: AssetClass): boolean => a === 'Rgb20' || a === 'Rgb21';
const isVoucherAsset = (a: AssetClass): boolean => a === 'Voucher';

/**
 * Release-facing availability. RGB/Voucher pairs that pair-policy allows are
 * available against webycash-server Workers on Cloudflare (issuer-hosted bearer
 * rails). We do not claim full rgb-std/AluVM client validation here.
 */
export function pairReleaseAvailability(a: AssetClass, b: AssetClass): PairReleaseAvailability {
	const verdict = evaluatePair(a, b);
	if (!verdict.allowed) {
		return {
			available: false,
			exclusion: 'pair-policy-blocked',
			message: verdict.label
		};
	}
	if (isRgbAsset(a) || isRgbAsset(b) || isVoucherAsset(a) || isVoucherAsset(b)) {
		return {
			available: true,
			message:
				verdict.label +
				' — rail: webycash-server Worker (issuer-hosted bearer; not rgb-std/AluVM).'
		};
	}
	return { available: true, message: verdict.label };
}

export const isPairAvailableInRelease = (a: AssetClass, b: AssetClass): boolean =>
	pairReleaseAvailability(a, b).available;
