/**
 * Off-chain Ark send from this wallet's own VTXOs (Arkade SDK `send`). Every
 * signature comes from the extro-node WASM (`WasmArkIdentity`); JS only checks
 * the request and drives the ASP. `validateArkSend` is pure (unit-tested).
 */
import { WasmArkIdentity } from './wasm-identity';
import { getRuntimeConfig } from '$lib/extro/runtime-config';

export const ARK_DUST_SATS = 330;

export type ArkSendCheck = { ok: true; amount: number } | { ok: false; reason: string };

/** `hrp` is the expected bech32m prefix: `ark` (mainnet) or `tark` (test networks). */
export function validateArkSend(input: {
	address: string;
	amount: number;
	balanceSats: number;
	ownAddress: string;
	hrp: string;
	dustSats?: number;
}): ArkSendCheck {
	const address = input.address.trim().toLowerCase();
	const dust = input.dustSats ?? ARK_DUST_SATS;
	if (!new RegExp(`^${input.hrp}1[02-9ac-hj-np-z]{40,}$`).test(address)) {
		return { ok: false, reason: `not an ${input.hrp}1… Ark address for this network` };
	}
	if (address === input.ownAddress.trim().toLowerCase()) {
		return { ok: false, reason: 'destination is this wallet' };
	}
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
		return { ok: false, reason: 'amount must be a positive whole number of sats' };
	}
	if (input.amount < dust) return { ok: false, reason: `amount below Ark dust (${dust} sat)` };
	if (input.amount > input.balanceSats) {
		return { ok: false, reason: `amount exceeds off-chain balance (${input.balanceSats} sat)` };
	}
	return { ok: true, amount: input.amount };
}

export async function sendArk(input: {
	address: string;
	amount: number;
	balanceSats: number;
	ownAddress: string;
}): Promise<{ arkTxId: string; amount: number; address: string }> {
	const cfg = getRuntimeConfig();
	if (!cfg.ark_enabled) throw new Error('Bitcoin ARK is disabled on this deployment');
	const { Wallet, isValidArkAddress } = await import('@arkade-os/sdk');
	const wallet = await Wallet.create({
		identity: new WasmArkIdentity(0),
		arkServerUrl: cfg.ark_asp_url,
		// No background auto-settle racing this explicit spend.
		settlementConfig: false
	});
	try {
		const own = await wallet.getAddress();
		if (own !== input.ownAddress) throw new Error('SDK Ark address differs from the WASM-derived one');
		const hrp = own.slice(0, own.indexOf('1'));
		const dust = Number((wallet as unknown as { dustAmount?: bigint }).dustAmount ?? BigInt(ARK_DUST_SATS));
		const check = validateArkSend({ ...input, hrp, dustSats: dust });
		if (!check.ok) throw new Error(check.reason);
		if (!isValidArkAddress(input.address.trim())) throw new Error('invalid Ark address checksum');
		const arkTxId = await wallet.send({ address: input.address.trim(), amount: check.amount });
		if (!/^[0-9a-f]{64}$/i.test(arkTxId)) throw new Error('ASP returned a malformed Ark tx id');
		return { arkTxId: arkTxId.toLowerCase(), amount: check.amount, address: input.address.trim() };
	} finally {
		await (wallet as { dispose?: () => Promise<void> }).dispose?.().catch(() => {});
	}
}
