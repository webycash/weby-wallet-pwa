// Asset-pair policy for the Webycash exchange.
//
// Source of truth (asset model + pair matrix):
//   extro/docs/development/24-extro-402-scheme-and-webycash-plan.md §"Asset Model".
//
// This MIRRORS the extrolib default-deny pair policy on the wallet/UI side. It
// is a SECOND, independent re-derivation — extro-node also re-derives the
// verdict from the signed order request and never trusts an incoming one
// (`Scheme402Command::OrderRequest`). The UI must not let a user reach a
// confirm button for a pair this rejects, and must never label a bearer flow as
// strictly atomic.
//
// CRITICAL invariants:
//   * Deny by default. An unknown / unhandled pair is rejected, never allowed.
//   * Order-independent. policy(A,B) === policy(B,A).
//   * Webcash <-> Voucher is blocked (both bearer-only; no arbitrable leg).
//   * Custom / two-bearer pairs are blocked.
//   * At least one side of a cross-rail bearer swap must be referee- or
//     contract-arbitrable (Bitcoin ARK or RGB).
//   * No bearer flow is ever described as cryptographically atomic — the
//     settlement label is referee-mediated / bounded-risk / non-atomic.

export type AssetClass = 'Webcash' | 'Voucher' | 'BitcoinArk' | 'Rgb20' | 'Rgb21' | 'Custom';

/** The settlement model a pair resolves to. Never "atomic" for a bearer leg. */
export type SettlementModel =
	// Referee mediates; bearer leg is non-atomic / bounded-risk.
	| 'referee-mediated'
	// RGB server / AluVM / HTLC enforces the conditional transition.
	| 'rgb-conditional'
	// RGB-to-RGB server-assisted atomic/conditional transition.
	| 'rgb-atomic'
	// The pair is not permitted at all.
	| 'blocked';

export interface PairVerdict {
	allowed: boolean;
	settlementModel: SettlementModel;
	/** Whether a referee is required to mediate this pair. */
	requiresReferee: boolean;
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
	| 'rgb-vs-bearer-conditional'
	| 'rgb-vs-ark'
	| 'rgb-vs-rgb'
	| 'unknown-pair';

const BEARER: ReadonlySet<AssetClass> = new Set<AssetClass>(['Webcash', 'Voucher']);
const RGB: ReadonlySet<AssetClass> = new Set<AssetClass>(['Rgb20', 'Rgb21']);

const isBearer = (a: AssetClass): boolean => BEARER.has(a);
const isRgb = (a: AssetClass): boolean => RGB.has(a);
const isArk = (a: AssetClass): boolean => a === 'BitcoinArk';

const deny = (reason: PairReason, label: string): PairVerdict => ({
	allowed: false,
	settlementModel: 'blocked',
	requiresReferee: false,
	bearerRaceRisk: false,
	reason,
	label
});

/**
 * Re-derive the settlement policy for an ordered pair. The result is identical
 * for (a,b) and (b,a) — orientation is normalised internally.
 */
export function evaluatePair(a: AssetClass, b: AssetClass): PairVerdict {
	// Custom / unknown asset on either side: hard block. (Mirrors the
	// coordinator's two-bearer/Custom block.)
	if (a === 'Custom' || b === 'Custom') {
		return deny('custom-asset-unsupported', 'Custom assets are not tradeable on this exchange.');
	}

	// Two bearer legs (incl. Webcash<->Voucher, Webcash<->Webcash,
	// Voucher<->Voucher): neither side is arbitrable, the referee cannot enforce
	// a safe release on either leg. Block.
	if (isBearer(a) && isBearer(b)) {
		return deny(
			'both-bearer-no-arbitrable-leg',
			'Both sides are bearer assets (Webcash/Voucher). No arbitrable leg exists, so this pair is blocked.'
		);
	}

	// Bearer <-> Bitcoin ARK: allowed WITH a referee. Bearer leg is non-atomic.
	if ((isBearer(a) && isArk(b)) || (isArk(a) && isBearer(b))) {
		return {
			allowed: true,
			settlementModel: 'referee-mediated',
			requiresReferee: true,
			bearerRaceRisk: true,
			reason: 'bearer-vs-ark-referee',
			label:
				'Referee-mediated swap. The bearer leg is non-atomic and carries bounded race risk — not a cryptographically atomic swap.'
		};
	}

	// RGB <-> Bearer (Webcash/Voucher): allowed ONLY with the RGB leg providing
	// the conditional/arbitrable side; bearer-race risk is explicit.
	if ((isRgb(a) && isBearer(b)) || (isBearer(a) && isRgb(b))) {
		return {
			allowed: true,
			settlementModel: 'rgb-conditional',
			// The RGB conditional leg is the enforcement primitive, but the bearer
			// side can still be raced, so a referee/contract-arbitrable path is
			// required for the bearer leg.
			requiresReferee: true,
			bearerRaceRisk: true,
			reason: 'rgb-vs-bearer-conditional',
			label:
				'RGB-conditional swap. The RGB leg enforces the condition; the bearer leg is non-atomic and bounded-risk.'
		};
	}

	// RGB <-> Bitcoin ARK: allowed. Prefer cryptographic HTLC / RGB-ARK contract.
	// No bearer leg, so no bearer-race risk; referee only if the flow needs it
	// (we mark not-required here — the contract path is preferred).
	if ((isRgb(a) && isArk(b)) || (isArk(a) && isRgb(b))) {
		return {
			allowed: true,
			settlementModel: 'rgb-conditional',
			requiresReferee: false,
			bearerRaceRisk: false,
			reason: 'rgb-vs-ark',
			label: 'RGB/ARK conditional swap via HTLC or RGB-ARK contract path.'
		};
	}

	// RGB <-> RGB: allowed; prefer RGB-server-assisted atomic/conditional
	// transition. No referee required when the RGB server can enforce.
	if (isRgb(a) && isRgb(b)) {
		return {
			allowed: true,
			settlementModel: 'rgb-atomic',
			requiresReferee: false,
			bearerRaceRisk: false,
			reason: 'rgb-vs-rgb',
			label: 'RGB-server-assisted atomic/conditional state transition.'
		};
	}

	// ARK <-> ARK or anything unhandled: deny by default.
	return deny('unknown-pair', 'This asset pair is not supported.');
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
