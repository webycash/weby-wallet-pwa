// Mock extro-node adapter — the DEFAULT adapter for dev and tests.
//
// It implements {@link ExtroAdapter} with deterministic, in-memory behaviour
// that mirrors the SHAPES extro-node returns, so the exchange module can be
// developed and fully unit-tested without a built WASM artifact or a live
// referee. It does NOT implement real cryptography, rkyv decoding, or rail
// settlement.
//
// IMPORTANT for the F-PWA-1 single-flight test: this adapter is deliberately
// WILLING to run concurrently — it tracks how many `dispatch` calls are
// in-flight and exposes `maxConcurrent`. If the facade fails to serialize,
// `maxConcurrent` will exceed 1 and the test fails. The adapter itself adds no
// concurrency control; that is the facade's responsibility.

import type { ExtroAdapter } from './client';
import {
	expectedOutcomeLabel,
	type ExtroCommand,
	type ExtroResponse,
	type HookOutcome,
	type ResponseBody
} from './commands';

/** A controllable deferred used to hold a dispatch open in tests. */
export interface Gate {
	promise: Promise<void>;
	release: () => void;
}

export const makeGate = (): Gate => {
	let release!: () => void;
	const promise = new Promise<void>((res) => {
		release = res;
	});
	return { promise, release };
};

export interface MockNodeOptions {
	/**
	 * If set, each `dispatch` awaits this gate before resolving. Tests use it to
	 * force overlap windows and prove serialization.
	 */
	gate?: Gate;
	/** Force the next hook dispatch outcome (e.g. simulate a locked wallet). */
	forceHookOutcome?: HookOutcome;
}

export class MockExtroAdapter implements ExtroAdapter {
	readonly mode = 'mock' as const;

	/** Number of dispatches currently between entry and resolution. */
	inFlight = 0;
	/** High-water mark of {@link inFlight}. MUST stay 1 under the facade. */
	maxConcurrent = 0;
	/** Total dispatches handled. */
	calls = 0;

	private booted = false;
	private opts: MockNodeOptions;

	constructor(opts: MockNodeOptions = {}) {
		this.opts = opts;
	}

	setOptions(opts: Partial<MockNodeOptions>): void {
		this.opts = { ...this.opts, ...opts };
	}

	async boot(): Promise<void> {
		this.booted = true;
	}

	async dispatch(command: ExtroCommand): Promise<ExtroResponse> {
		if (!this.booted) {
			return { kind: 'Err', request_id: command.request_id, code: 'NotBooted', message: 'mock not booted' };
		}

		this.inFlight += 1;
		this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
		this.calls += 1;
		try {
			// Yield once so overlapping callers (if any leaked past the queue)
			// would actually interleave here.
			await Promise.resolve();
			if (this.opts.gate) await this.opts.gate.promise;
			return this.respond(command);
		} finally {
			this.inFlight -= 1;
		}
	}

	private respond(command: ExtroCommand): ExtroResponse {
		const ok = (body: ResponseBody): ExtroResponse => ({
			kind: 'Ok',
			request_id: command.request_id,
			body
		});
		const op = command.op;

		switch (op.kind) {
			case 'Wallet': {
				const c = op.cmd;
				if (c.op === 'DeriveIdentity')
					return ok({
						kind: 'Identity',
						fingerprint_hex: 'fp'.repeat(10),
						verifying_key: new Uint8Array(32),
						slot: c.slot
					});
				if (c.op === 'DeriveFamilyHandle')
					return ok({ kind: 'FamilyHandle', address: `mock:${c.family}:${c.index}`, slot: c.slot, index: c.index });
				if (c.op === 'ListSummaries') return ok({ kind: 'Summaries', families: [] });
				return ok({ kind: 'Empty' });
			}
			case 'Scheme402': {
				const c = op.cmd;
				if (c.op === 'SimplePay')
					return ok({ kind: 'SignedRetry', retry: new Uint8Array(0), receipt_id: c.idempotency });
				if (c.op === 'VerifyPaymentRequest')
					// Pair-policy / order semantics are NOT computed here — the
					// exchange app re-derives them from its own pair-policy module.
					// This returns only the request's public commitments.
					return ok({
						kind: 'PaymentRequestVerified',
						idempotency: new Uint8Array(16),
						amount_raw: 0n,
						asset_family: 'webcash',
						payee_fingerprint: new Uint8Array(20),
						accepts_referee: true
					});
				if (c.op === 'AcceptEncryptedBearerDelivery')
					return ok({
						kind: 'DeliveryAccepted',
						delivery_id: new Uint8Array(16),
						recipient_fingerprint: c.expected_recipient_fp,
						ciphertext_hash: new Uint8Array(32)
					});
				if (c.op === 'ConditionalVerify')
					return ok({
						kind: 'ConditionalVerified',
						session_id: new Uint8Array(16),
						outcome: expectedOutcomeLabel(c.expect_outcome),
						referee_released: true
					});
				return ok({ kind: 'Empty' });
			}
			case 'Hook':
			case 'Push': {
				const outcome: HookOutcome = this.opts.forceHookOutcome ?? 'Processed';
				return ok({ kind: 'Hook', outcome });
			}
		}
	}
}
