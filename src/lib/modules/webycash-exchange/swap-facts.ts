// Assemble the `TwoProofFacts` object the off-thread prover (`extro/prover.ts`)
// feeds to `Op::Scheme402::SwapInitiate`.
//
// Source of truth for the field-by-field shape + types:
//   extro/extro-node/examples/swap_initiate_request/main.rs  (the canonical
//   wallet-side fixture) and extro/extro-node/src/wasm/codec.rs
//   (`two_proof_facts_from_js` / `asset_ref_from_js`) — the JS Reflect mapping
//   the WASM actually reads. This file MIRRORS those exactly:
//
//   - byte fields ride as `Uint8Array` (fixed-length ones are length-checked
//     in-WASM: order_id/public_token_hash/tx_*_hash = 32, *_fp = 20,
//     conditional_payload = CONDITIONAL_WITNESS_LEN = 128).
//   - `fill_amount_raw` rides as a JS `bigint` (codec `get_u128`).
//   - `asset` is `{ family: 'BitcoinArk' }` (the AssetRef discriminant; optional
//     contract_id/issuer_fp/rail_hint omitted for the ARK rail).
//   - hex string fields (musig2 pubkey, nonces, cancel pubkeys, locked_ref) ride
//     as strings.
//   - `bearer_amount` is the decimal string of the bearer face value; the
//     referee builds the rail token `e{bearer_amount}:public:{H}`.
//
// SECRECY: this builder takes only PUBLIC commitments + the bearer's own public
// `H`. The plaintext bearer secret never enters this object — the prover derives
// the bearer witness inside the WASM worker from the imported seed.

import { getExtroClient } from '$lib/extro';
import { newRequestId } from '$lib/extro/commands';
import type { LimitOrder } from './types';

/** Fixed conditional-leg witness length (extro_circuits::CONDITIONAL_WITNESS_LEN). */
export const CONDITIONAL_WITNESS_LEN = 128;

/** The bearer-payload circuit version the deployed referee selects its 6-input VK by. */
export const BEARER_CIRCUIT_VERSION = 'bearer_payload.v2';

/**
 * The provider's published MuSig2 / ARK material for one swap — exactly the
 * shape `Op::Scheme402::ProviderMaterial` returns (`musig2_pubkey`,
 * `settle_nonce`, `refund_nonce`, all hex). The provider's settling secp256k1
 * material. Every field is required; this boundary rejects the former dev
 * placeholders before a proof or referee request can be created.
 */
export interface ProviderMaterial {
	/** 33-byte compressed secp256k1 pubkey, hex. */
	musig2_pubkey: string;
	/** 66-byte MuSig2 public settle nonce, hex. */
	settle_nonce: string;
	/** 66-byte MuSig2 public refund nonce, hex. */
	refund_nonce: string;
	/** Provider (maker) 20-byte PGP/identity fingerprint from authenticated DHTX. */
	provider_fp: string;
	/** The provider's raw PGP public-key bytes, hex (bearer recipient commitment). */
	provider_pgp_pubkey: string;
	/** The provider's 2-of-2 cancel-path pubkey, hex. */
	provider_cancel_pubkey_hex: string;
	/** The ARK conditional leg's real VTXO outpoint (`txid:vout`). */
	locked_ref: string;
	/** Settlement tx hash the conditional binding pins (32-byte hex). */
	tx_settle_hash_hex: string;
	/** Refund tx hash (32-byte hex). */
	tx_refund_hash_hex: string;
	/** Length-framed encryption of the provider's genuine settle partial. */
	conditional_payload: Uint8Array;
}

/**
 * The taker's (bearer-seller's) own settle identity — the CONDITIONAL leg's
 * recipient. Sourced from the taker's OWN wallet (its identity vk + fp + cancel
 * pubkey), so it is real and self-owned, not pasted. Mirrors the bytes the taker
 * put on the wire in its `SwapMsgBody::Accept`.
 */
export interface BearerSellerIdentity {
	/** 20-byte PGP/identity fingerprint, hex. */
	bearer_seller_fp: string;
	/** Raw PGP public-key bytes, hex (conditional recipient commitment). */
	bearer_seller_pgp_pubkey: string;
	/** 2-of-2 cancel-path pubkey, hex. */
	bearer_seller_cancel_pubkey_hex: string;
}

/**
 * The bearer leg the taker contributes: the public hash `H` of their webcash
 * secret and the face value. Sourced from the wallet's Webcash family handle
 * (`e{amount}:public:{H}`) via {@link bearerLegFromWallet}.
 */
export interface BearerLeg {
	/** 32-byte SHA-256 public token hash `H`, decoded from the handle address. */
	publicTokenHash: Uint8Array;
	/** Decimal face-value string (the `e{amount}` segment of the handle). */
	bearerAmount: string;
	/** Atomic fill amount, as a bigint (the ZKP binds this as `fill_amount_raw`). */
	fillAmountRaw: bigint;
}

/** The TwoProofFacts JS object the prover passes straight to `SwapInitiate`. */
export interface TwoProofFacts {
	asset: { family: 'BitcoinArk' };
	order_id: Uint8Array; // 32
	fill_amount_raw: bigint;
	public_token_hash: Uint8Array; // 32
	provider_fp: Uint8Array; // 20
	provider_pgp_pubkey: Uint8Array;
	bearer_seller_fp: Uint8Array; // 20
	bearer_seller_pgp_pubkey: Uint8Array;
	enc_secret_for_provider: Uint8Array;
	conditional_payload: Uint8Array; // CONDITIONAL_WITNESS_LEN (128)
	locked_ref: string;
	tx_settle_hash: Uint8Array; // 32
	tx_refund_hash: Uint8Array; // 32
	provider_musig2_pubkey: string;
	provider_cancel_pubkey_hex: string;
	bearer_seller_cancel_pubkey_hex: string;
	settle_nonce_pub: string;
	refund_nonce_pub: string;
	bearer_amount: string;
	circuit_version: string;
	idempotency_key?: string;
}

const hexToBytes = (hex: string): Uint8Array => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0) throw new Error(`odd-length hex (${clean.length})`);
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	return out;
};

/**
 * Parse a Webcash family-handle address `e{amount}:public:{H}` into its decimal
 * amount + the 32-byte `H`. Throws if the address is not a Webcash public handle.
 */
export function parseWebcashHandle(address: string): { amount: string; hash: Uint8Array } {
	const m = /^e(\d+):public:([0-9a-fA-F]{64})$/.exec(address.trim());
	if (!m) throw new Error(`not a Webcash public handle: ${address}`);
	return { amount: m[1], hash: hexToBytes(m[2]) };
}

/**
 * Derive the bearer leg from the wallet's Webcash family handle via
 * `DeriveFamilyHandle{family:'Webcash'}`. The handle address is
 * `e{amount}:public:{H}`; `H` is the bearer `public_token_hash` and `amount`
 * the `bearer_amount`. `fillAmountRaw` defaults to the handle's face value.
 */
export async function bearerLegFromWallet(
	slot = 0,
	index = 0,
	fillAmountRaw?: bigint
): Promise<BearerLeg> {
	const client = getExtroClient();
	const res = await client.send({
		request_id: newRequestId(),
		op: {
			kind: 'Wallet',
			cmd: { op: 'DeriveFamilyHandle', family: 'Webcash', slot, index, namespace: null }
		}
	});
	if (res.kind === 'Err') throw new Error(`DeriveFamilyHandle(Webcash): ${res.message}`);
	if (res.body.kind !== 'FamilyHandle') {
		throw new Error(`DeriveFamilyHandle(Webcash): unexpected ${res.body.kind}`);
	}
	const { amount, hash } = parseWebcashHandle(res.body.address);
	return {
		publicTokenHash: hash,
		bearerAmount: amount,
		fillAmountRaw: fillAmountRaw ?? BigInt(amount)
	};
}

export interface BuildFactsInput {
	/** The selected, signature-verified maker order being filled. */
	order: LimitOrder;
	/** The taker's bearer leg (from {@link bearerLegFromWallet}). */
	bearer: BearerLeg;
	/** The provider's published MuSig2/ARK material for this swap. */
	provider: ProviderMaterial;
	/**
	 * The taker's required bearer-seller identity (conditional recipient),
	 * sourced from the taker's wallet and authenticated Accept — never pasted.
	 */
	bearerSeller: BearerSellerIdentity;
	/** Wallet-produced encryption of the bearer secret to the provider's attested key. */
	encSecretForProvider: Uint8Array;
	/** Optional 16-byte idempotency key, hex; omit for a fresh swap. */
	idempotencyKeyHex?: string;
}

const exactHexBytes = (value: string, n: number, name: string): Uint8Array => {
	if (typeof value !== 'string') {
		throw new Error(`${name} must be exactly ${n} bytes of hexadecimal data`);
	}
	const clean = value.startsWith('0x') ? value.slice(2) : value;
	if (clean.length !== n * 2 || !/^[0-9a-f]+$/i.test(clean)) {
		throw new Error(`${name} must be exactly ${n} bytes of hexadecimal data`);
	}
	const bytes = hexToBytes(clean);
	if (bytes.every((byte) => byte === 0)) throw new Error(`${name} must not be all zero`);
	return bytes;
};

const exactBytes = (value: Uint8Array, n: number, name: string): Uint8Array => {
	if (!(value instanceof Uint8Array) || value.length !== n) {
		throw new Error(`${name} must be exactly ${n} bytes`);
	}
	if (value.every((byte) => byte === 0)) throw new Error(`${name} must not be all zero`);
	return value.slice();
};

const exactCompressedKey = (value: string, name: string): string => {
	if (typeof value !== 'string') {
		throw new Error(`${name} must be a 33-byte compressed secp256k1 public key`);
	}
	const clean = value.toLowerCase();
	if (!/^0[23][0-9a-f]{64}$/.test(clean)) {
		throw new Error(`${name} must be a 33-byte compressed secp256k1 public key`);
	}
	return clean;
};

const exactPublicNonce = (value: string, name: string): string => {
	if (typeof value !== 'string') {
		throw new Error(`${name} must be a 66-byte MuSig2 public nonce`);
	}
	const clean = value.toLowerCase();
	if (!/^[0-9a-f]{132}$/.test(clean)) {
		throw new Error(`${name} must be a 66-byte MuSig2 public nonce`);
	}
	if (/^0+$/.test(clean)) throw new Error(`${name} must not be all zero`);
	return clean;
};

const validateLockedRef = (value: string): string => {
	if (typeof value !== 'string') {
		throw new Error('locked_ref must be a real Ark VTXO outpoint (`txid:vout`)');
	}
	const match = /^([0-9a-f]{64}):(\d+)$/i.exec(value);
	if (!match) throw new Error('locked_ref must be a real Ark VTXO outpoint (`txid:vout`)');
	const vout = Number(match[2]);
	if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff) {
		throw new Error('locked_ref vout is outside the u32 range');
	}
	return `${match[1].toLowerCase()}:${vout}`;
};

const validateConditionalPayload = (value: Uint8Array): Uint8Array => {
	if (!(value instanceof Uint8Array) || value.length !== CONDITIONAL_WITNESS_LEN) {
		throw new Error(`conditional_payload must be exactly ${CONDITIONAL_WITNESS_LEN} bytes`);
	}
	const rawLength = new DataView(value.buffer, value.byteOffset, 4).getUint32(0, false);
	if (rawLength === 0 || rawLength > CONDITIONAL_WITNESS_LEN - 4) {
		throw new Error('conditional_payload has an invalid framed ciphertext length');
	}
	if (value.subarray(4, 4 + rawLength).every((byte) => byte === 0)) {
		throw new Error('conditional_payload ciphertext must not be all zero');
	}
	if (!value.subarray(4 + rawLength).every((byte) => byte === 0)) {
		throw new Error('conditional_payload has non-zero bytes after the framed ciphertext');
	}
	return value.slice();
};

/**
 * Assemble {@link TwoProofFacts} from a selected order, the wallet bearer leg,
 * and the provider's MuSig2 material.
 *
 * All fields must come from the authenticated order/Accept exchange, the two
 * wallets, and the prepared Ark contract. This function checks wire shape and
 * cross-field identity binding. It cannot establish that opaque bytes are a
 * decryptable ciphertext; the wallet encryption API and ZKP must establish
 * that separately before Gate 3 can be enabled.
 */
export function buildSwapInitiateFacts(input: BuildFactsInput): TwoProofFacts {
	const { order, bearer, provider, bearerSeller, encSecretForProvider, idempotencyKeyHex } = input;
	if (bearer.fillAmountRaw <= 0n) throw new Error('fill_amount_raw must be positive');
	if (!/^[1-9][0-9]*$/.test(bearer.bearerAmount)) {
		throw new Error('bearer_amount must be a positive decimal integer');
	}
	const publicTokenHash = exactBytes(bearer.publicTokenHash, 32, 'public_token_hash');
	if (idempotencyKeyHex !== undefined) {
		exactHexBytes(idempotencyKeyHex, 16, 'idempotency_key');
	}

	// The maker order id is a 16-byte hex; the circuit's `order_id` is a fixed
	// 32-byte field, so the 16-byte id is left-padded into the 32-byte slot.
	const orderId = new Uint8Array(32);
	orderId.set(exactHexBytes(order.id, 16, 'order.id'), 16);

	// The DHTX provider must be the same maker whose order signature was accepted.
	const providerFp = exactHexBytes(provider.provider_fp, 20, 'provider_fp');
	const orderMakerFp = exactHexBytes(order.makerFingerprint, 20, 'order.makerFingerprint');
	if (!providerFp.every((byte, index) => byte === orderMakerFp[index])) {
		throw new Error('provider_fp does not match the signed order maker fingerprint');
	}
	// REAL provider pgp pubkey: the maker's identity key bytes over DHTX.
	const providerPgp = exactHexBytes(provider.provider_pgp_pubkey, 32, 'provider_pgp_pubkey');

	// REAL bearer-seller identity: the taker's OWN wallet identity (self-owned).
	const sellerFp = exactHexBytes(bearerSeller.bearer_seller_fp, 20, 'bearer_seller_fp');
	const sellerPgp = exactHexBytes(
		bearerSeller.bearer_seller_pgp_pubkey,
		32,
		'bearer_seller_pgp_pubkey'
	);

	// Reject missing/obviously public substitutes. The caller still has to create
	// this with the canonical wallet encryption API; byte length is not proof of
	// correct encryption and must never be presented as one.
	if (!(encSecretForProvider instanceof Uint8Array) || encSecretForProvider.length < 48) {
		throw new Error(
			'enc_secret_for_provider must be a genuine encrypted envelope (at least 48 bytes)'
		);
	}
	const formerHashSubstitute = new Uint8Array(bearer.publicTokenHash.length + providerPgp.length);
	formerHashSubstitute.set(bearer.publicTokenHash, 0);
	formerHashSubstitute.set(providerPgp, bearer.publicTokenHash.length);
	if (
		encSecretForProvider.length === formerHashSubstitute.length &&
		encSecretForProvider.every((byte, index) => byte === formerHashSubstitute[index])
	) {
		throw new Error('enc_secret_for_provider is a public hash concatenation, not ciphertext');
	}

	const conditionalPayload = validateConditionalPayload(provider.conditional_payload);
	const lockedRef = validateLockedRef(provider.locked_ref);
	const settleHash = exactHexBytes(provider.tx_settle_hash_hex, 32, 'tx_settle_hash_hex');
	const refundHash = exactHexBytes(provider.tx_refund_hash_hex, 32, 'tx_refund_hash_hex');
	const providerCancel = exactHexBytes(
		provider.provider_cancel_pubkey_hex,
		32,
		'provider_cancel_pubkey_hex'
	);
	const sellerCancel = exactHexBytes(
		bearerSeller.bearer_seller_cancel_pubkey_hex,
		32,
		'bearer_seller_cancel_pubkey_hex'
	);

	return {
		asset: { family: 'BitcoinArk' },
		order_id: orderId,
		fill_amount_raw: bearer.fillAmountRaw,
		public_token_hash: publicTokenHash,
		// REAL: the maker (provider) PGP fingerprint + pubkey, over DHTX.
		provider_fp: providerFp,
		provider_pgp_pubkey: providerPgp,
		// REAL: the taker's own bearer-seller identity (self-owned).
		bearer_seller_fp: sellerFp,
		bearer_seller_pgp_pubkey: sellerPgp,
		enc_secret_for_provider: encSecretForProvider.slice(),
		// The provider's encrypted Ark settle partial, length-framed to the
		// conditional circuit's fixed witness size.
		conditional_payload: conditionalPayload,
		// Prepared Ark contract and deterministic transaction references.
		locked_ref: lockedRef,
		tx_settle_hash: settleHash,
		tx_refund_hash: refundHash,
		// REAL: the provider's MuSig2 settling identity + nonces (over DHTX).
		provider_musig2_pubkey: exactCompressedKey(provider.musig2_pubkey, 'provider_musig2_pubkey'),
		provider_cancel_pubkey_hex: Array.from(providerCancel, (byte) =>
			byte.toString(16).padStart(2, '0')
		).join(''),
		bearer_seller_cancel_pubkey_hex: Array.from(sellerCancel, (byte) =>
			byte.toString(16).padStart(2, '0')
		).join(''),
		settle_nonce_pub: exactPublicNonce(provider.settle_nonce, 'settle_nonce_pub'),
		refund_nonce_pub: exactPublicNonce(provider.refund_nonce, 'refund_nonce_pub'),
		bearer_amount: bearer.bearerAmount,
		circuit_version: BEARER_CIRCUIT_VERSION,
		...(idempotencyKeyHex ? { idempotency_key: idempotencyKeyHex } : {})
	};
}
