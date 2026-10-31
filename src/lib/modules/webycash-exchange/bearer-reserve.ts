/**
 * Bearer leg reservation BEFORE the swap (never mints): moves exactly the
 * bearer face value out of the real webcash wallet into the deterministic
 * swap bearer scalar (webcash family, index `index`) via extro-node
 * `ReserveWebcash`. Idempotent: an already-unspent reservation is a no-op.
 *
 * Order of effects (no value can be stranded):
 *   1. payWebcash(exact)  → a fresh exact-amount secret leaves the wallet
 *   2. ReserveWebcash     → server replace(that secret → bearer scalar)
 *   3. on reserve failure → the secret is re-inserted into the wallet
 * The reserved bearer secret is re-derivable from the master (never stored
 * in the spendable wallet, so the wallet cannot double-spend the leg).
 */
import { webcashReserve } from '$lib/extro/rail';
import { insertWebcash, payWebcash } from '$lib/stores/wallet.svelte';

export const WATS_PER_WEBCASH = 100_000_000n;

/** Exact decimal webcash → wats (≤ 8 decimals, positive). */
export function webcashToWats(amount: string): bigint {
	const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(amount.trim());
	if (!m) throw new Error(`bearer amount ${JSON.stringify(amount)} is not a decimal webcash amount`);
	const wats = BigInt(m[1]) * WATS_PER_WEBCASH + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
	if (wats <= 0n) throw new Error('bearer amount must be positive');
	return wats;
}

export type BearerReserveDeps = {
	pay: (wats: number) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
	insert: (secret: string) => Promise<{ ok: true; value: void } | { ok: false; error: string }>;
	reserve: typeof webcashReserve;
	/** Rail status of `publicToken` (the swap bearer leg). */
	status: () => Promise<'unspent' | 'spent' | 'absent'>;
};

export const walletReserveDeps = (status: BearerReserveDeps['status']): BearerReserveDeps => ({
	pay: payWebcash as BearerReserveDeps['pay'],
	insert: insertWebcash as BearerReserveDeps['insert'],
	reserve: webcashReserve,
	status
});

export type BearerReserveResult = { publicToken: string; index: number; reused: boolean };

export async function reserveBearerLeg(
	args: { index: number; amount: string; publicToken: string; serverUrl: string; maxWebcash?: string },
	deps: BearerReserveDeps
): Promise<BearerReserveResult> {
	const wats = webcashToWats(args.amount);
	if (args.maxWebcash !== undefined && wats > webcashToWats(args.maxWebcash)) {
		throw new Error(`bearer reserve: ${args.amount} exceeds the per-direction cap ${args.maxWebcash}`);
	}
	// Idempotent: an existing unspent reservation is reused; a SPENT scalar is
	// never reused (that bearer leg was already consumed by a past swap).
	const before = await deps.status();
	if (before === 'unspent') return { publicToken: args.publicToken, index: args.index, reused: true };
	if (before === 'spent') {
		throw new Error(`bearer reserve: bearer scalar at index ${args.index} is already SPENT; use a fresh index`);
	}

	const paid = await deps.pay(Number(wats));
	if (!paid.ok) throw new Error(`bearer reserve: wallet cannot fund ${args.amount} webcash (${paid.error})`);
	const out = await deps.reserve({ index: args.index, amount: args.amount, inputs: [paid.value], serverUrl: args.serverUrl });
	if (out.state !== 'ok' || !out.value.unspent || out.value.public_token !== args.publicToken) {
		const why = out.state === 'error' ? out.message : out.state === 'ok' ? 'reserved token is not the unspent swap bearer leg' : 'unsupported';
		const back = await deps.insert(paid.value);
		throw new Error(
			`bearer reserve failed (${why}); ${back.ok ? 'funds re-inserted into the wallet' : `RE-INSERT FAILED: ${back.error}`}`
		);
	}
	if (out.value.change) {
		const c = await deps.insert(out.value.change);
		if (!c.ok) throw new Error(`bearer reserve: change re-insert failed (${c.error})`);
	}
	return { publicToken: out.value.public_token, index: args.index, reused: false };
}
