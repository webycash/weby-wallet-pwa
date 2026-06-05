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
 * material; placeholder dev values are rejected by the referee's real signer.
 */
export interface ProviderMaterial {
	/** 33-byte compressed secp256k1 pubkey, hex. */
	musig2_pubkey: string;
	/** 66-byte MuSig2 public settle nonce, hex. */
	settle_nonce: string;
	/** 66-byte MuSig2 public refund nonce, hex. */
	refund_nonce: string;
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

/** A fixed-length byte field of `n` bytes filled with `fill` (dev placeholder). */
const placeholderBytes = (n: number, fill: number): Uint8Array => new Uint8Array(n).fill(fill);

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
	/** The selected (mock/dev or, later, real) maker order being filled. */
	order: LimitOrder;
	/** The taker's bearer leg (from {@link bearerLegFromWallet}). */
	bearer: BearerLeg;
	/** The provider's published MuSig2/ARK material for this swap. */
	provider: ProviderMaterial;
	/** Optional 16-byte idempotency key, hex; omit for a fresh swap. */
	idempotencyKeyHex?: string;
}

/**
 * Assemble {@link TwoProofFacts} from a selected order, the wallet bearer leg,
 * and the provider's MuSig2 material.
 *
 * REAL (sourced from a live order / wallet / provider):
 *   - `asset` (ARK), `order_id` (the maker order id), `fill_amount_raw` +
 *     `bearer_amount` + `public_token_hash` (the wallet's Webcash handle),
 *     `provider_fp` + `bearer_seller_fp` (the order's maker fingerprint / the
 *     taker's own fingerprint), and the provider MuSig2 material
 *     (`provider_musig2_pubkey` / `settle_nonce_pub` / `refund_nonce_pub`).
 *
 * PLACEHOLDER (until a real order/peer channel supplies them — see TODOs):
 *   - `provider_pgp_pubkey` / `bearer_seller_pgp_pubkey`: the parties' PGP
 *     public keys (from a keyserver Discover / the order envelope).
 *   - `enc_secret_for_provider`: the taker's webcash secret encrypted to the
 *     provider's PGP key (sealed by the wallet at request time).
 *   - `conditional_payload`: the provider's ARK settle partial-sig encrypted to
 *     the taker, framed to CONDITIONAL_WITNESS_LEN (the maker-response payload).
 *   - `locked_ref` / `tx_settle_hash` / `tx_refund_hash`: the ARK vtxo lock ref
 *     and the settle/refund tx hashes (from the provider's ARK material).
 *   - `provider_cancel_pubkey_hex` / `bearer_seller_cancel_pubkey_hex`: the
 *     2-of-2 cancel-path pubkeys.
 */
export function buildSwapInitiateFacts(input: BuildFactsInput): TwoProofFacts {
	const { order, bearer, provider, idempotencyKeyHex } = input;

	// The maker order id is a 16-byte hex; the circuit's `order_id` is a fixed
	// 32-byte field, so the 16-byte id is left-padded into the 32-byte slot.
	const orderId = new Uint8Array(32);
	orderId.set(hexToBytes(order.id).subarray(0, 32), 32 - 16);

	return {
		asset: { family: 'BitcoinArk' },
		order_id: orderId,
		fill_amount_raw: bearer.fillAmountRaw,
		public_token_hash: bearer.publicTokenHash,
		// REAL: the maker (provider) PGP fingerprint and the taker's own.
		provider_fp: hexToBytes(order.makerFingerprint),
		// TODO(order-channel): provider PGP public key — from keyserver Discover
		// or the order envelope. Placeholder until the peer channel supplies it.
		provider_pgp_pubkey: placeholderBytes(32, 0xbb),
		// TODO(wallet): the taker's own 20-byte PGP fingerprint (DeriveIssuer/
		// DerivePgpPublicKey). Placeholder until wired to the active identity.
		bearer_seller_fp: placeholderBytes(20, 0xaa),
		// TODO(wallet): taker's own PGP public key.
		bearer_seller_pgp_pubkey: placeholderBytes(32, 0xaa),
		// TODO(wallet): the taker's webcash secret sealed to the provider's PGP
		// key. Built by the wallet at request time; placeholder for now.
		enc_secret_for_provider: placeholderBytes(48, 0xcc),
		// TODO(maker-response): the provider's ARK settle partial-sig encrypted to
		// the taker, framed to exactly CONDITIONAL_WITNESS_LEN. Placeholder until
		// the maker-response payload arrives.
		conditional_payload: placeholderBytes(CONDITIONAL_WITNESS_LEN, 0xdd),
		// TODO(provider-ark): the ARK vtxo locked reference (64-hex) + settle /
		// refund tx hashes — from the provider's published ARK material.
		locked_ref: 'v'.repeat(64),
		tx_settle_hash: placeholderBytes(32, 0xab),
		tx_refund_hash: placeholderBytes(32, 0xcf),
		// REAL: the provider's MuSig2 settling identity + nonces.
		provider_musig2_pubkey: provider.musig2_pubkey,
		// TODO(provider-ark): the 2-of-2 cancel-path pubkeys.
		provider_cancel_pubkey_hex: '11'.repeat(32),
		bearer_seller_cancel_pubkey_hex: '22'.repeat(32),
		settle_nonce_pub: provider.settle_nonce,
		refund_nonce_pub: provider.refund_nonce,
		bearer_amount: bearer.bearerAmount,
		circuit_version: BEARER_CIRCUIT_VERSION,
		...(idempotencyKeyHex ? { idempotency_key: idempotencyKeyHex } : {})
	};
}
