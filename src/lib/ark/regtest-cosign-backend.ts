/**
 * Regtest/dev-only DedicatedCosignBackend factory.
 *
 * Production and CF **dev** deploys leave `setDedicatedCosignBackend(null)` so
 * settle/refund stay at named gates. Local arkade-regtest harnesses inject a
 * backend that returns genuine MuSig2 partials (via extro-node
 * `gate3_musig2_cosign` or an in-process signer) bound to real locked_ref digests.
 */
import type { DedicatedCosignBackend, DedicatedCosignReceipt, ArkSpendTemplate } from './swap-spend';

export type RegtestCosignFn = (template: ArkSpendTemplate) => Promise<DedicatedCosignReceipt>;

/** Build an inject-only cosign backend; never used when ark_enabled is false. */
export function createRegtestCosignBackend(handlers: {
	signSettle: RegtestCosignFn;
	signRefund: RegtestCosignFn;
}): DedicatedCosignBackend {
	return {
		signSettle: (t) => handlers.signSettle(t),
		signRefund: (t) => handlers.signRefund(t)
	};
}
