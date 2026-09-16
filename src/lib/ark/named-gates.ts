/**
 * Named Gate 3 / staging blockers. UI and runners must surface these exact
 * strings — never invent a settled terminal phase when stopped here.
 */

/** Dev/runtime pin: Ark spend and ProviderMaterial stay closed. */
export const GATE_ARK_DISABLED =
	'ARK_DISABLED: ark_enabled=false; genuine settle/refund and ProviderMaterial remain closed on this deployment';

/** SendProviderMaterial WASM boundary until real locked_ref + tx hashes exist. */
export const GATE_PROVIDER_MATERIAL_UNSUPPORTED =
	'PROVIDER_MATERIAL_UNSUPPORTED: SendProviderMaterial is disabled until browser Ark supplies genuine locked_ref and settle/refund transaction hashes';

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

export type NamedArkGate =
	| typeof GATE_ARK_DISABLED
	| typeof GATE_PROVIDER_MATERIAL_UNSUPPORTED
	| typeof GATE_SETTLE_SIGNER_PENDING
	| typeof GATE_REFUND_SIGNER_PENDING
	| typeof GATE_PREPARE_REQUIRES_ARK
	| typeof GATE_RUNSWAP_STOPPED_NO_PROVIDER;

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
