// Family-handle derivation over the extro facade.
//
// The asset-tab shells (Bitcoin / RGB / Vouchers) read a receive address from
// extro-node via the `DeriveFamilyHandle` wallet command. This is the ONE live
// extro-node call the shells make today; everything else value-moving is an
// honest "coming via extro-node" state until the command surface lands.
//
// Pure, declarative wrapper: map a UI tab -> WireFamily, dispatch one command,
// project the typed response down to `{ address } | { error }`. No mutation,
// no side effects beyond the single facade round-trip.

import { getExtroClient } from './index';
import { newRequestId, isOk, type WireFamily } from './commands';
import type { AssetTab } from '$lib/stores/navigation.svelte';

/** Map an asset tab to its extro-node WireFamily discriminant. */
export const TAB_FAMILY: Record<AssetTab, WireFamily> = {
	webcash: 'Webcash',
	bitcoin: 'Bitcoin',
	rgb: 'Rgb',
	vouchers: 'Voucher',
};

export type FamilyAddress =
	| { ok: true; address: string }
	| { ok: false; error: string };

/**
 * Derive the receive address for an asset family at (slot, index) via
 * `DeriveFamilyHandle`. Returns a discriminated result — never throws — so the
 * caller renders either the address or an honest error line.
 */
export const deriveFamilyAddress = async (
	tab: AssetTab,
	slot = 0,
	index = 0,
): Promise<FamilyAddress> => {
	try {
		const client = getExtroClient();
		const res = await client.send({
			request_id: newRequestId(),
			op: { kind: 'Wallet', cmd: { op: 'DeriveFamilyHandle', family: TAB_FAMILY[tab], slot, index, namespace: null } },
		});
		if (isOk(res) && res.body.kind === 'FamilyHandle') return { ok: true, address: res.body.address };
		const message = res.kind === 'Err' ? res.message : 'Unexpected response';
		return { ok: false, error: message };
	} catch (e) {
		return { ok: false, error: `${e}` };
	}
};
