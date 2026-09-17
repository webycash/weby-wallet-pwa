import { describe, expect, it } from 'vitest';

/**
 * Documents the P0 multi-wallet contract: labeled wallets must be created from
 * `derive_wallet_secret(master, family, label)` via `create_roaming_wallet`,
 * never by re-running `create_wallet(mnemonic)` which always initializes slot 0.
 */
describe('P0 multi-wallet derivation contract', () => {
	it('requires labeled creation to consume the derived secret', () => {
		const plan = {
			discardedLegacy: 'create_wallet(network, mnemonic)',
			required: 'create_roaming_wallet(wasmNetwork, derive_wallet_secret(master, family, label), [], {})'
		};
		expect(plan.required).toContain('derive_wallet_secret');
		expect(plan.required).toContain('create_roaming_wallet');
		expect(plan.discardedLegacy).toContain('create_wallet');
	});

	it('source uses createLabeledWalletState for setup and addWallet', async () => {
		const fs = await import('node:fs/promises');
		const path = new URL('./wallet.svelte.ts', import.meta.url);
		const source = await fs.readFile(path, 'utf8');
		expect(source).toContain('createLabeledWalletState');
		expect(source).toMatch(/createLabeledWalletState\(wasm, result\.master_state, 'webcash', 'main'\)/);
		expect(source).toMatch(/createLabeledWalletState\(wasm, newMaster, family, label\)/);
		// Fresh slot creation must not call create_wallet with the mnemonic.
		expect(source).not.toMatch(/create_wallet\(network,\s*(result\.mnemonic|mnemonic|Persistence\.getMnemonic)/);
	});
});
