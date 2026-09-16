// Extro client facade with a single-flight dispatch queue (F-PWA-1).
//
// WHY single-flight is mandatory:
//   The extro-node WASM `extro_node_send` borrows the booted `RuntimeCtx` with
//   `RefCell::borrow_mut()` for the *entire* duration of an async dispatch
//   (see extro-node/src/wasm/exports.rs::dispatch). A second `extro_node_send`
//   entered before the first resolves takes a SECOND `borrow_mut()` on the same
//   RefCell → `already borrowed: BorrowMutError` → wasm panic. JS is
//   single-threaded but `async` interleaves at await points, so two overlapping
//   `await client.send(...)` calls WILL interleave into the borrow unless we
//   serialize them here.
//
// The queue lives in the FACADE (not the adapter) so every adapter — mock,
// bundled WASM, cross-domain — is protected identically and the contract is
// testable against the mock.

import type { ExtroCommand, ExtroResponse } from './commands';

/**
 * The transport an adapter implements. `dispatch` performs exactly one
 * round-trip for one command. The adapter MUST NOT add its own concurrency
 * control — serialization is the client's job (F-PWA-1).
 */
export interface ExtroAdapter {
	readonly mode: AdapterMode;
	/** Boot/initialise the underlying transport. Idempotent. */
	boot(): Promise<void>;
	/** Dispatch one command, resolving to its typed response. */
	dispatch(command: ExtroCommand): Promise<ExtroResponse>;
}

export type AdapterMode = 'mock' | 'bundled' | 'cross-domain';

/**
 * Facade over an {@link ExtroAdapter} that guarantees at most ONE in-flight
 * dispatch at a time. Calls queue FIFO; each awaits the previous before
 * touching the adapter.
 */
export class ExtroClient {
	private readonly adapter: ExtroAdapter;
	private booted = false;
	private bootPromise: Promise<void> | null = null;
	/** Tail of the single-flight chain. Resolves when the queue is drained. */
	private tail: Promise<unknown> = Promise.resolve();

	constructor(adapter: ExtroAdapter) {
		this.adapter = adapter;
	}

	get mode(): AdapterMode {
		return this.adapter.mode;
	}

	/** Boot the underlying adapter once. Concurrent callers share one boot. */
	async boot(): Promise<void> {
		if (this.booted) return;
		if (!this.bootPromise) {
			this.bootPromise = this.adapter.boot().then(() => {
				this.booted = true;
			});
		}
		return this.bootPromise;
	}

	/**
	 * Send one command through the single-flight queue. Resolves with the typed
	 * response. A rejection of one queued send does NOT poison later sends — the
	 * chain advances regardless of outcome.
	 */
	send(command: ExtroCommand): Promise<ExtroResponse> {
		// Chain this dispatch onto the tail. `prior` is the work that must finish
		// before we may touch the adapter. We swallow `prior`'s outcome (`catch`)
		// purely for ordering — the caller of the PRIOR send already owns its
		// result/rejection.
		const prior = this.tail;
		const run = prior
			.catch(() => undefined)
			.then(async () => {
				await this.boot();
				return this.adapter.dispatch(command);
			});
		// Advance the tail. Swallow here too so an awaited rejection upstream
		// cannot leave the chain in a rejected state that blocks the next send.
		this.tail = run.catch(() => undefined);
		return run;
	}

	/**
	 * Test/observability hook: resolves once the current queue is fully drained.
	 */
	async idle(): Promise<void> {
		await this.tail.catch(() => undefined);
	}
}
