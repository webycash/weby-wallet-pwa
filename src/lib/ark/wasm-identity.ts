/**
 * Arkade SDK `Identity` whose private key never leaves the extro-node WASM.
 *
 * Public keys come from `Scheme402 ArkPublicKey`; every BIP-340 signature is
 * produced by `Scheme402 ArkSchnorrSign` (scope WalletSign(Ark), fails closed
 * while the wallet is locked). JS only computes the BIP-341 tapscript sighash.
 */
import { tapLeafHash } from '@scure/btc-signer/payment.js';
import { SingleKey, type Identity, type Transaction } from '@arkade-os/sdk';
import { getExtroClient } from '$lib/extro';
import { newRequestId } from '$lib/extro/commands';

/** BIP-341 SIGHASH_DEFAULT. */
const SIGHASH_DEFAULT = 0;

const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
	a.length === b.length && a.every((x, i) => x === b[i]);

const containsBytes = (hay: Uint8Array, needle: Uint8Array): boolean => {
	outer: for (let i = 0; i + needle.length <= hay.length; i++) {
		for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
		return true;
	}
	return false;
};

export async function wasmArkPublicKey(slot = 0): Promise<{ compressed: Uint8Array; xonly: Uint8Array }> {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Scheme402', cmd: { op: 'ArkPublicKey', slot } }
	});
	if (res.kind === 'Err') throw new Error(`ArkPublicKey: ${res.message}`);
	if (res.body.kind !== 'ArkPublicKey') throw new Error(`ArkPublicKey: unexpected ${res.body.kind}`);
	return { compressed: hexToBytes(res.body.compressed_hex), xonly: hexToBytes(res.body.xonly_hex) };
}

export async function wasmArkSchnorrSign(digest: Uint8Array, slot = 0): Promise<Uint8Array> {
	if (digest.length !== 32) throw new Error('ArkSchnorrSign digest must be 32 bytes');
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Scheme402', cmd: { op: 'ArkSchnorrSign', slot, digest: digest.slice() } }
	});
	if (res.kind === 'Err') throw new Error(`ArkSchnorrSign: ${res.message}`);
	if (res.body.kind !== 'ArkSchnorrSignature') {
		throw new Error(`ArkSchnorrSign: unexpected ${res.body.kind}`);
	}
	const sig = hexToBytes(res.body.signature_hex);
	if (sig.length !== 64) throw new Error('ArkSchnorrSign returned a malformed signature');
	return sig;
}

export class WasmArkIdentity implements Identity {
	private keys: Promise<{ compressed: Uint8Array; xonly: Uint8Array }> | null = null;
	constructor(private readonly slot = 0) {}

	private pub() {
		this.keys ??= wasmArkPublicKey(this.slot);
		return this.keys;
	}
	async xOnlyPublicKey(): Promise<Uint8Array> {
		return (await this.pub()).xonly.slice();
	}
	async compressedPublicKey(): Promise<Uint8Array> {
		return (await this.pub()).compressed.slice();
	}
	signerSession() {
		// Tree-signing sessions are ephemeral random MuSig2 nonce/key sessions (no wallet key
		// material); borrow the SDK's keyless factory via a throwaway SingleKey.
		return SingleKey.fromRandomBytes().signerSession();
	}
	async signMessage(message: Uint8Array, signatureType: 'schnorr' | 'ecdsa' = 'schnorr'): Promise<Uint8Array> {
		if (signatureType !== 'schnorr') throw new Error('WasmArkIdentity only signs BIP-340 schnorr');
		if (message.length !== 32) throw new Error('WasmArkIdentity signs 32-byte digests only');
		return wasmArkSchnorrSign(message, this.slot);
	}

	/** Sign every tapscript leaf that commits to this identity's x-only key. */
	async sign(tx: Transaction, inputIndexes?: number[]): Promise<Transaction> {
		const out = tx.clone();
		const xonly = await this.xOnlyPublicKey();
		const indexes = inputIndexes ?? Array.from({ length: out.inputsLength }, (_, i) => i);
		const prevScripts: Uint8Array[] = [];
		const amounts: bigint[] = [];
		for (let i = 0; i < out.inputsLength; i++) {
			const utxo = out.getInput(i).witnessUtxo;
			if (!utxo) throw new Error(`input #${i} lacks witnessUtxo; cannot compute taproot sighash`);
			prevScripts.push(utxo.script);
			amounts.push(utxo.amount);
		}
		let signedAny = false;
		for (const idx of indexes) {
			const input = out.getInput(idx);
			const sighashType = input.sighashType ?? SIGHASH_DEFAULT;
			for (const [, scriptWithVersion] of input.tapLeafScript ?? []) {
				const script = scriptWithVersion.subarray(0, -1);
				const version = scriptWithVersion[scriptWithVersion.length - 1];
				if (!containsBytes(script, xonly)) continue;
				const leafHash = tapLeafHash(script, version);
				const already = (input.tapScriptSig ?? []).some(
					([k]) => sameBytes(k.pubKey, xonly) && sameBytes(k.leafHash, leafHash)
				);
				if (already) continue;
				const digest = out.preimageWitnessV1(idx, prevScripts, sighashType, amounts, undefined, script, version);
				let sig = await wasmArkSchnorrSign(digest, this.slot);
				if (sighashType !== SIGHASH_DEFAULT) sig = Uint8Array.from([...sig, sighashType]);
				out.updateInput(idx, { tapScriptSig: [[{ pubKey: xonly, leafHash }, sig]] });
				signedAny = true;
			}
			if (inputIndexes && !signedAny) throw new Error(`Failed to sign input #${idx}`);
		}
		return out;
	}
}
