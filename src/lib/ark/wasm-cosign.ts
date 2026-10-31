/**
 * WASM-backed Ark cosigner (blocker 3). The provider's Ark scalar never leaves
 * extro-node: the settle leaf is a MuSig2 partial from `Scheme402
 * ProviderPartialSign` (single-use nonce committed in the published
 * ProviderMaterial), and the provider-CSV refund is a BIP-340 signature from
 * `Scheme402 ArkSchnorrSign`. Both need scope WalletSign(Ark) and an unlocked
 * wallet; JS only routes public data.
 */
import { getExtroClient } from '$lib/extro';
import { newRequestId } from '@extro/node';
import type { ArkSpendTemplate, DedicatedCosignBackend, DedicatedCosignReceipt } from './swap-spend';
import { wasmArkPublicKey, wasmArkSchnorrSign } from './wasm-identity';

const HEX32 = /^[0-9a-f]{64}$/i;
const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const bytesToHex = (b: Uint8Array): string =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** extro-node `provider_fill_id`: `hex(order_id):hex(counterparty_fp)`. */
export function providerFillId(orderIdHex: string, counterpartyFpHex: string): string {
	if (!/^[0-9a-f]{32}$/i.test(orderIdHex)) throw new Error('order id must be 16 bytes hex');
	if (!/^[0-9a-f]{40}$/i.test(counterpartyFpHex)) throw new Error('counterparty fingerprint must be 20 bytes hex');
	return `${orderIdHex.toLowerCase()}:${counterpartyFpHex.toLowerCase()}`;
}

export async function wasmProviderPartialSign(input: {
	slot?: number;
	fillId: string;
	session: 'settle' | 'refund';
	refereePkHex: string;
	/** The swap the 2-of-2 key is tweaked to (audit C1). */
	swapId: string;
	/** The swap's 32-byte prepare request commitment (audit C1). */
	requestCommitment: Uint8Array;
	refereeNonceHex: string;
	msg: Uint8Array;
}): Promise<string> {
	// sighash-bundle-v1: one 32-byte message per session ([checkpoint, ark]).
	const n = input.msg.length / 32;
	if (!Number.isInteger(n) || n < 1 || n > 2) {
		throw new Error('ProviderPartialSign msg must be 1..2 × 32 bytes');
	}
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Scheme402',
			cmd: {
				op: 'ProviderPartialSign',
				slot: input.slot ?? 0,
				fill_id: input.fillId,
				session: input.session,
				referee_pk_hex: input.refereePkHex,
				swap_id: input.swapId,
				request_commitment: input.requestCommitment.slice(),
				referee_nonce_hex: input.refereeNonceHex,
				msg: input.msg.slice()
			}
		}
	});
	if (res.kind === 'Err') throw new Error(`ProviderPartialSign: ${res.message}`);
	if (res.body.kind !== 'ProviderPartial')
		throw new Error(`ProviderPartialSign: unexpected ${res.body.kind}`);
	const partial = res.body.partial_hex;
	if (typeof partial !== 'string' || partial.length !== 64 * n || !/^[0-9a-f]+$/i.test(partial)) {
		throw new Error('ProviderPartialSign returned a malformed partial');
	}
	return partial.toLowerCase();
}

export type WasmCosignOpts = {
	slot?: number;
	fillId: string;
	/** Referee 2-of-2 pubshare (33-byte compressed hex). */
	refereePkHex: string;
	/** The swap the 2-of-2 key is tweaked to (audit C1). */
	swapId: string;
	/** The swap's 32-byte prepare request commitment (audit C1). */
	requestCommitment: Uint8Array;
	/** Referee public nonce for the settle session (66-byte hex), from the referee settle ceremony. */
	refereeSettleNonceHex: string;
};

export class WasmProviderCosignBackend implements DedicatedCosignBackend {
	constructor(private readonly opts: WasmCosignOpts) {}

	async signSettle(template: ArkSpendTemplate): Promise<DedicatedCosignReceipt> {
		if (template.leaf !== 'collaborative-settle') throw new Error('signSettle needs the collaborative-settle template');
		if (!HEX32.test(template.templateDigestHex)) throw new Error('settle template digest is malformed');
		const partial = await wasmProviderPartialSign({
			slot: this.opts.slot,
			fillId: this.opts.fillId,
			session: 'settle',
			refereePkHex: this.opts.refereePkHex,
			swapId: this.opts.swapId,
			requestCommitment: this.opts.requestCommitment,
			refereeNonceHex: this.opts.refereeSettleNonceHex,
			msg: hexToBytes(template.templateDigestHex)
		});
		return { signatureHex: partial };
	}

	async signRefund(template: ArkSpendTemplate): Promise<DedicatedCosignReceipt> {
		if (template.leaf !== 'provider-csv-refund') throw new Error('signRefund needs the provider-csv-refund template');
		if (!HEX32.test(template.templateDigestHex)) throw new Error('refund template digest is malformed');
		const { xonly } = await wasmArkPublicKey(this.opts.slot ?? 0);
		if (bytesToHex(xonly) !== template.providerRecoveryKeyHex.toLowerCase()) {
			throw new Error('refund recovery key is not this wallet’s Ark key; refusing to sign');
		}
		const sig = await wasmArkSchnorrSign(hexToBytes(template.templateDigestHex), this.opts.slot ?? 0);
		return { signatureHex: bytesToHex(sig) };
	}
}
