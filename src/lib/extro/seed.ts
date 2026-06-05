// Seed + unlock the bundled extro-node wallet from the PWA's mnemonic.
//
// The extro-node wasm wallet boots LOCKED: its `RuntimeCtx` master wallet is
// constructed empty, so address derivation (`DeriveFamilyHandle`) and the rail
// balances that derive an address fail with `wallet locked` until a seed is
// loaded. The PWA already owns the canonical 24-word mnemonic (behind its own
// unlock / passkey gate); this module bridges it into the extro-node wallet by
// dispatching one `Import` command, which transitions the extro-node
// MasterWallet to *Unlocked* for the session (see extro-node
// wallet/master.rs `generate`).
//
// We re-`Import` from the mnemonic on every PWA unlock rather than persisting
// the returned sealed envelope and `Unlock`-ing it: the seed is deterministic
// from the mnemonic, and the mnemonic store is the real same-origin security
// boundary, so the seal passphrase here is a throwaway — it never guards
// anything we keep. This keeps the extro-node wallet's lock state slaved to the
// PWA's, with no second secret to manage.

import { getExtroClient, getExtroMode } from './index';
import { newRequestId, isOk } from './commands';

// Throwaway seal passphrase (see module note): the envelope is never persisted
// or re-opened, so this value guards nothing — it only satisfies `Import`'s
// seal step. A stable constant keeps the seal deterministic within a session.
const SESSION_PASSPHRASE = new TextEncoder().encode('extro-node-session');

// Per-page-load latch: at most one successful Import per unlock cycle. Reset by
// {@link resetExtroSeed} when the PWA locks, so a re-unlock re-seeds.
let seeded = false;

/**
 * Seed + unlock the bundled extro-node wallet from `mnemonic`. No-op (returns
 * `false`) in mock mode — the mock adapter needs no seed — and a no-op once
 * seeded for this unlock cycle. Never throws: a failed Import returns `false`
 * and leaves the latch open so a later attempt can retry.
 */
export async function seedExtroWallet(mnemonic: string | null): Promise<boolean> {
	if (seeded) return true;
	if (!mnemonic || getExtroMode() === 'mock') return false;
	try {
		const res = await getExtroClient().send({
			request_id: newRequestId(),
			op: { kind: 'Wallet', cmd: { op: 'Import', mnemonic, passphrase: SESSION_PASSPHRASE } }
		});
		seeded = isOk(res);
		return seeded;
	} catch {
		return false;
	}
}

/** Clear the per-load seed latch (call on PWA lock) so the next unlock re-seeds. */
export function resetExtroSeed(): void {
	seeded = false;
}
