// In-browser 402 swap runner — the REAL initiate path.
//
// Drives one swap end to end from the PWA, off the UI thread for the heavy part:
//
//   0. prepared   — require a non-expired, pinned-referee-verified allocation
//                    created from byte-identical terms signed by both parties.
//   1. proving    — fetch the two Groth16 proving keys (once, cached), derive
//                    the bearer leg from the wallet, build the TwoProofFacts, and
//                    run `proveSwapInitiate` in a Web Worker (tens of seconds of
//                    BN254 proving — NEVER on the main thread).
//   2. initiating  — POST the rkyv InitiateRequest envelope to the referee
//                    (`POST /v1/swap/initiate`), receiving the assigned swap id.
//   3. advancing   — open a local Trade at the referee-reported phase and drive
//                    it to a terminal phase through the trade-timeline machine.
//   4. settled / failed.
//
// SECRECY: the wallet mnemonic is passed straight to the prover worker (which
// boots its own wasm instance, imports the seed, proves, and is then
// terminated). The seed never touches the main-thread wasm or the store.
//
// NOT atomic: the bearer leg is referee-mediated and race-bounded (see
// pair-policy). Progress copy here must never claim a cryptographically atomic
// swap.

import { proveSwapInitiate } from '$lib/extro/prover';
import {
	confirmArkSwapFunding,
	type ArkFundingReader,
	type ArkSwapContract
} from '$lib/ark/swap-contract';
import {
	bearerLegFromWallet,
	buildSwapInitiateFacts,
	type BearerSellerIdentity,
	type PreparedSwapBinding,
	type ProviderMaterial
} from './swap-facts';
import type { RefereeClient } from './referee-client';
import type { LimitOrder } from './types';

/**
 * Where the development proving keys are served from. Release assembly runs
 * `npm run install:zkp` with the ceremony output directory; the keys are never
 * silently sourced from a sibling checkout or treated as production-safe.
 */
const BEARER_PK_URL = '/circuits-dev/pk_bearer_payload.bin';
const CONDITIONAL_PK_URL = '/circuits-dev/pk_conditional_leg.bin';

/** Coarse phase of the runner, surfaced to the UI alongside the Trade timeline. */
export type SwapStage =
	| 'idle'
	| 'verifying-ark'
	| 'fetching-keys'
	| 'proving'
	| 'initiating'
	| 'advancing'
	| 'settled'
	| 'failed';

export interface SwapProgress {
	stage: SwapStage;
	/** Referee-assigned swap id once initiated. */
	swapId?: string;
	/** Latest referee-reported phase. */
	phase?: string;
	/** Machine error message on `failed`. */
	error?: string;
}

export interface ProofKeys {
	bearerPk: Uint8Array;
	conditionalPk: Uint8Array;
}

// ── Proving-key cache ─────────────────────────────────────────────────────────
//
// The two keys are ~38 MB combined; fetch them at most once per page load. The
// cache is a module-level PROMISE (not a singleton object) so concurrent callers
// share one in-flight fetch and a failed fetch is retried on the next call.

let keysPromise: Promise<ProofKeys> | null = null;

async function fetchKey(url: string, fetchFn: typeof fetch): Promise<Uint8Array> {
	const r = await fetchFn(url);
	if (!r.ok) throw new Error(`fetch ${url}: ${r.status} ${r.statusText}`);
	return new Uint8Array(await r.arrayBuffer());
}

/** Fetch (and cache) the two dev Groth16 proving keys. */
export function loadProofKeys(fetchFn: typeof fetch = fetch): Promise<ProofKeys> {
	if (!keysPromise) {
		keysPromise = Promise.all([
			fetchKey(BEARER_PK_URL, fetchFn),
			fetchKey(CONDITIONAL_PK_URL, fetchFn)
		])
			.then(([bearerPk, conditionalPk]) => ({ bearerPk, conditionalPk }))
			.catch((e) => {
				keysPromise = null; // allow retry on the next call
				throw e;
			});
	}
	return keysPromise;
}

/** Test/reset hook: drop the cached proving keys. */
export function resetProofKeys(): void {
	keysPromise = null;
}

export interface ExecuteSwapInput {
	/** The selected (mock/dev or, later, real) maker order to fill. */
	order: LimitOrder;
	/** BIP39 mnemonic of the active wallet — passed to the prover worker only. */
	mnemonic: string;
	/** The provider's published MuSig2/ARK material for this swap (over DHTX). */
	provider: ProviderMaterial;
	/** The taker's OWN bearer-seller identity (conditional recipient, self-owned). */
	bearerSeller: BearerSellerIdentity;
	/** Genuine wallet-produced encryption of the bearer secret to the provider. */
	encSecretForProvider: Uint8Array;
	/** Dual-signed, referee-allocated session verified by extro-node. */
	prepared: PreparedSwapBinding;
	/** Contract derived from the exact signed V2 prepare response. */
	arkContract: ArkSwapContract;
	/** Indexer-backed reader used to re-check `locked_ref` immediately before proving. */
	arkFundingReader: ArkFundingReader;
	/**
	 * Optional staging hook run AFTER `initiate` reaches `insert-pushed` and
	 * BEFORE the first `advance`. This is where the bearer-rail spend (the
	 * provider-claim `/replace` that flips `H` to Spent) happens — the swap
	 * front-run guard requires `H` Unspent at initiate and Spent at advance, so
	 * the spend MUST land between the two. Receives the assigned swap id.
	 */
	afterInitiate?: (swapId: string) => Promise<void>;
	/** The referee to submit + advance against. */
	referee: RefereeClient;
	/** Progress callback (proving → initiating → advancing → settled/failed). */
	onProgress?: (p: SwapProgress) => void;
	/** Wallet slot/index for the bearer Webcash handle (defaults 0/0). */
	slot?: number;
	index?: number;
	/** Atomic fill amount; defaults to the bearer handle's face value. */
	fillAmountRaw?: bigint;
	fetchFn?: typeof fetch;
}

export interface ExecuteSwapResult {
	swapId: string;
	phase: string;
	terminal: boolean;
}

/**
 * Execute the in-browser swap-initiate path for one order. Resolves with the
 * referee swap id and the terminal phase; rejects (and emits a `failed`
 * progress) on any error.
 *
 * Heavy proving runs in a dedicated worker. The caller drives the local Trade
 * timeline from the returned ids/phases (or via the trade store).
 */
export async function executeSwap(input: ExecuteSwapInput): Promise<ExecuteSwapResult> {
	const {
		order,
		mnemonic,
		provider,
		bearerSeller,
		encSecretForProvider,
		prepared,
		arkContract,
		arkFundingReader,
		afterInitiate,
		referee,
		onProgress,
		slot = 0,
		index = 0,
		fillAmountRaw,
		fetchFn = fetch
	} = input;
	const emit = (p: SwapProgress) => onProgress?.(p);

	try {
		if (prepared.expiresAtUnix <= BigInt(Math.floor(Date.now() / 1000))) {
			throw new Error('prepared swap allocation has expired; prepare again before proving');
		}
		if (
			arkContract.plan.swapId !== prepared.swapId ||
			arkContract.plan.requestCommitment.length !== prepared.requestCommitment.length ||
			!arkContract.plan.requestCommitment.every(
				(byte, index) => byte === prepared.requestCommitment[index]
			)
		) {
			throw new Error('Ark contract is not bound to the prepared swap allocation');
		}
		emit({ stage: 'verifying-ark' });
		await confirmArkSwapFunding(arkFundingReader, arkContract, provider.locked_ref);
		emit({ stage: 'fetching-keys' });
		const [{ bearerPk, conditionalPk }, bearer] = await Promise.all([
			loadProofKeys(fetchFn),
			bearerLegFromWallet(slot, index, fillAmountRaw)
		]);

		const facts = buildSwapInitiateFacts({
			order,
			bearer,
			provider,
			bearerSeller,
			encSecretForProvider,
			prepared
		});

		emit({ stage: 'proving' });
		const envelope = await proveSwapInitiate({ mnemonic, bearerPk, conditionalPk, facts });

		emit({ stage: 'initiating' });
		const { swap_id, phase } = await referee.initiate(envelope);
		emit({ stage: 'advancing', swapId: swap_id, phase });

		// STAGING: the bearer-rail spend (provider-claim `/replace`) must land
		// between initiate (H Unspent) and advance (H Spent) — the front-run guard.
		if (afterInitiate) await afterInitiate(swap_id);

		const final = await advanceToTerminal(referee, swap_id, (phase) =>
			emit({ stage: 'advancing', swapId: swap_id, phase })
		);

		// Only a settled/completed terminal phase is a success; refunded/canceled/
		// failed (or hitting the step cap without a terminal phase) are not.
		const succeeded =
			final.terminal && (final.phase === 'settled' || final.phase === 'completed');
		emit({
			stage: succeeded ? 'settled' : 'failed',
			swapId: swap_id,
			phase: final.phase
		});
		return { swapId: swap_id, phase: final.phase, terminal: final.terminal };
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		emit({ stage: 'failed', error });
		throw e instanceof Error ? e : new Error(error);
	}
}

const TERMINAL_REFEREE_PHASES = new Set(['settled', 'completed', 'refunded', 'failed', 'canceled']);

/**
 * Poll `advance` until the referee reports a terminal phase (capped). Emits each
 * reported phase via `onPhase`.
 */
async function advanceToTerminal(
	referee: RefereeClient,
	swapId: string,
	onPhase: (phase: string) => void,
	maxSteps = 16
): Promise<{ phase: string; terminal: boolean }> {
	let phase = '';
	let terminal = false;
	for (let step = 0; step < maxSteps; step++) {
		const r = await referee.advance(swapId);
		phase = r.phase;
		onPhase(phase);
		if (r.terminal || TERMINAL_REFEREE_PHASES.has(phase)) {
			terminal = true;
			break;
		}
	}
	return { phase, terminal };
}
