/**
 * Named Gate 3 / staging blockers. UI and runners must surface these exact
 * strings — never invent a settled terminal phase when stopped here.
 */

/** Dev/runtime pin: Ark spend and ProviderMaterial stay closed. */
export const GATE_ARK_DISABLED =
	'ARK_DISABLED: ark_enabled=false; genuine settle/refund and ProviderMaterial remain closed on this deployment';

/** SendProviderMaterial WASM boundary until real locked_ref + tx hashes exist. */
export const GATE_PROVIDER_MATERIAL_UNSUPPORTED =
	'PROVIDER_MATERIAL_UNSUPPORTED: SendProviderMaterial requires genuine locked_ref and settle/refund transaction hashes (placeholders rejected)';

/** Collaborative settle MuSig2 partial not yet produced for a real VTXO. */
export const GATE_SETTLE_SIGNER_PENDING =
	'ARK_SETTLE_SIGNER_PENDING: deterministic settle template exists; dedicated MuSig2 co-sign against a funded VTXO is not yet available';

/** Provider-only CSV refund path not yet signed against a real VTXO. */
export const GATE_REFUND_SIGNER_PENDING =
	'ARK_REFUND_SIGNER_PENDING: deterministic provider-CSV refund template exists; dedicated recovery signer against a funded VTXO is not yet available';

/** Prepare/contract funding requires Ark enabled and operator pins. */
export const GATE_PREPARE_REQUIRES_ARK =
	'PREPARE_REQUIRES_ARK: dual-signed prepare + contract funding need ark_enabled with pinned operator facts';

/** UI reached runSwap but cannot fabricate ProviderMaterial. */
export const GATE_RUNSWAP_STOPPED_NO_PROVIDER =
	'RUNSWAP_STOPPED_NO_PROVIDER: UI reached runSwap/executeSwap boundary; stopped before proving because genuine ProviderMaterial is unavailable';

/** ProviderMaterial arrived (DHTX) but prepare/runSwap inputs are still incomplete. */
export const GATE_RUNSWAP_NEED_PREPARE =
	'RUNSWAP_NEED_PREPARE: genuine ProviderMaterial is present; dual-signed prepare + RunSwapInput binding still required before proving';

/** Provider reached the verified contract but its Ark balance cannot fund it. */
export const GATE_ARK_FUNDING_INSUFFICIENT =
	'ARK_FUNDING_INSUFFICIENT: referee-prepared contract derived; provider Ark balance is below the contract amount, so the 2-of-2 VTXO was not funded';

/** Bearer seller holds referee-prepared terms and waits for the provider's funded VTXO. */
export const GATE_ARK_AWAITING_PROVIDER_FUNDING =
	'ARK_AWAITING_PROVIDER_FUNDING: referee-prepared contract derived; the provider has not published a funded locked_ref + settle/refund hashes yet';

/** The configured referee cannot run the settle ceremony (old build / foreign pubshare / no partial). */
export const GATE_REFEREE_CEREMONY_UNAVAILABLE =
	'ARK_REFEREE_CEREMONY_UNAVAILABLE: the referee does not serve settle-ceremony-v1 for this swap; refusing to fund, sign or aggregate';

/** A ceremony input, partial or aggregate failed verification. */
export const GATE_SETTLE_CEREMONY_INVALID =
	'ARK_SETTLE_CEREMONY_INVALID: a settle ceremony key, nonce, partial or aggregate failed verification; nothing was signed or broadcast past this point';

/** Provider partial is signed + verified; the referee ReleaseSettle has not been delivered. */
export const GATE_SETTLE_RELEASE_PENDING =
	'ARK_SETTLE_RELEASE_PENDING: settle ceremony bound to the contract owner key Q; awaiting the referee ReleaseSettle (two-proof initiate + provider-partial delivery are not wired into this flow yet)';

/** Provider coop-refund-v1 (abort before insert) could not complete; funds stay in the 2-of-2 (provider CSV refund leaf remains). */
export const GATE_COOP_REFUND_FAILED =
	'ARK_COOP_REFUND_FAILED: the referee coop-refund-v1 cooperative refund did not complete; the VTXO stays locked under Q until retry or the provider CSV refund leaf';

export type NamedArkGate =
	| typeof GATE_ARK_FUNDING_INSUFFICIENT
	| typeof GATE_ARK_AWAITING_PROVIDER_FUNDING
	| typeof GATE_REFEREE_CEREMONY_UNAVAILABLE
	| typeof GATE_SETTLE_CEREMONY_INVALID
	| typeof GATE_SETTLE_RELEASE_PENDING
	| typeof GATE_ARK_DISABLED
	| typeof GATE_PROVIDER_MATERIAL_UNSUPPORTED
	| typeof GATE_SETTLE_SIGNER_PENDING
	| typeof GATE_REFUND_SIGNER_PENDING
	| typeof GATE_PREPARE_REQUIRES_ARK
	| typeof GATE_RUNSWAP_STOPPED_NO_PROVIDER
	| typeof GATE_RUNSWAP_NEED_PREPARE;

export class NamedArkGateError extends Error {
	readonly gate: string;
	constructor(gate: string) {
		super(gate);
		this.name = 'NamedArkGateError';
		this.gate = gate;
	}
}

export function isNamedArkGateError(e: unknown): e is NamedArkGateError {
	return e instanceof NamedArkGateError;
}

/** The taker's bearer leg H is not a live token on the webcash rail (`spent:null` = never issued). */
export const GATE_BEARER_LEG_NOT_ISSUED =
	'BEARER_LEG_NOT_ISSUED: the bearer webcash H is unknown to the rail (health_check spent:null); fund the bearer leg from the real wallet balance first — nothing is minted or mined';

/** The taker's bearer leg H is already spent, or its face amount does not cover the fill. */
export const GATE_BEARER_LEG_UNUSABLE =
	'BEARER_LEG_UNUSABLE: the bearer webcash H is spent or below the order fill amount; refusing to proceed';

/** Maker funding gate: the referee has not attested a passing pre-check for BOTH legs. */
export const GATE_REFEREE_PRECHECK_PENDING =
	'REFEREE_PRECHECK_PENDING: the referee has not attested a passing pre-check for both legs (bearer H unspent on the rail + provider terms); the 2-of-2 VTXO was NOT funded';
