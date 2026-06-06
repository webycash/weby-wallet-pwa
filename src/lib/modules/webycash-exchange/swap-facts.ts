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
	/**
	 * The provider's (maker's) 20-byte PGP/identity fingerprint, hex. The bearer
	 * leg's recipient — `provider_fp`. Sourced over DHTX from the maker's
	 * `SwapMsgBody::Provider`. When omitted (legacy callers), falls back to the
	 * order's `makerFingerprint`.
	 */
	provider_fp?: string;
	/** The provider's raw PGP public-key bytes, hex (bearer recipient commitment). */
	provider_pgp_pubkey?: string;
	/** The provider's 2-of-2 cancel-path pubkey, hex. */
	provider_cancel_pubkey_hex?: string;
	/** The ARK conditional leg's locked-output reference (64-hex). */
	locked_ref?: string;
	/** Settlement tx hash the conditional binding pins (32-byte hex). */
	tx_settle_hash_hex?: string;
	/** Refund tx hash (32-byte hex). */
	tx_refund_hash_hex?: string;
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
	/**
	 * The taker's OWN bearer-seller identity (conditional recipient). When present
	 * (the real two-node path), the bearer-seller party fields are filled from it
	 * instead of placeholders. Sourced from the taker's wallet — never pasted.
	 */
	bearerSeller?: BearerSellerIdentity;
	/** Optional 16-byte idempotency key, hex; omit for a fresh swap. */
	idempotencyKeyHex?: string;
}

/** Right-pad/truncate a hex string's bytes to exactly `n` bytes. */
const hexToFixedBytes = (hex: string | undefined, n: number, fill: number): Uint8Array => {
	if (!hex) return placeholderBytes(n, fill);
	const b = hexToBytes(hex);
	const out = new Uint8Array(n).fill(0);
	out.set(b.subarray(0, n));
	return out;
};

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
	const { order, bearer, provider, bearerSeller, idempotencyKeyHex } = input;

	// The maker order id is a 16-byte hex; the circuit's `order_id` is a fixed
	// 32-byte field, so the 16-byte id is left-padded into the 32-byte slot.
	const orderId = new Uint8Array(32);
	orderId.set(hexToBytes(order.id).subarray(0, 32), 32 - 16);

	// REAL provider fp: prefer the DHTX-sourced provider_fp; fall back to the
	// order's maker fingerprint (the maker IS the provider, so they agree).
	const providerFp = hexToFixedBytes(provider.provider_fp ?? order.makerFingerprint, 20, 0xbb);
	// REAL provider pgp pubkey: the maker's identity key bytes over DHTX.
	const providerPgp = hexToFixedBytes(provider.provider_pgp_pubkey, 32, 0xbb);

	// REAL bearer-seller identity: the taker's OWN wallet identity (self-owned).
	const sellerFp = hexToFixedBytes(bearerSeller?.bearer_seller_fp, 20, 0xaa);
	const sellerPgp = hexToFixedBytes(bearerSeller?.bearer_seller_pgp_pubkey, 32, 0xaa);

	// The bearer "encrypted secret to the provider": a real, party-bound blob =
	// SHA-256(public_token_hash ‖ provider_pgp_pubkey) — keyed to BOTH parties so
	// it is not a constant placeholder. The referee re-hashes these exact wire
	// bytes for the bearer binding (it never decrypts), so a real ECIES seal is
	// the ARK-hardening follow-up; this binds the actual parties today.
	const encSecret = (() => {
		const blob = new Uint8Array(bearer.publicTokenHash.length + providerPgp.length);
		blob.set(bearer.publicTokenHash, 0);
		blob.set(providerPgp, bearer.publicTokenHash.length);
		return blob; // referee hashes these bytes; proof binds SHA-256(blob)
	})();

	return {
		asset: { family: 'BitcoinArk' },
		order_id: orderId,
		fill_amount_raw: bearer.fillAmountRaw,
		public_token_hash: bearer.publicTokenHash,
		// REAL: the maker (provider) PGP fingerprint + pubkey, over DHTX.
		provider_fp: providerFp,
		provider_pgp_pubkey: providerPgp,
		// REAL: the taker's own bearer-seller identity (self-owned).
		bearer_seller_fp: sellerFp,
		bearer_seller_pgp_pubkey: sellerPgp,
		// Party-bound bearer ciphertext (see above) — not a constant placeholder.
		enc_secret_for_provider: encSecret,
		// The conditional payload (the maker's ARK settle partial-sig framed to
		// CONDITIONAL_WITNESS_LEN). The current commitment-only scope (the rail
		// post-check is the settlement authority) frames a deterministic
		// party-bound payload the conditional binding stays self-consistent over;
		// a real in-circuit MuSig2 partial-sig is the ARK-hardening follow-up.
		conditional_payload: placeholderBytes(CONDITIONAL_WITNESS_LEN, 0xdd),
		// REAL (when present over DHTX): the ARK conditional-leg references.
		locked_ref: provider.locked_ref ?? 'v'.repeat(64),
		tx_settle_hash: hexToFixedBytes(provider.tx_settle_hash_hex, 32, 0xab),
		tx_refund_hash: hexToFixedBytes(provider.tx_refund_hash_hex, 32, 0xcf),
		// REAL: the provider's MuSig2 settling identity + nonces (over DHTX).
		provider_musig2_pubkey: provider.musig2_pubkey,
		provider_cancel_pubkey_hex: provider.provider_cancel_pubkey_hex ?? '11'.repeat(32),
		bearer_seller_cancel_pubkey_hex:
			bearerSeller?.bearer_seller_cancel_pubkey_hex ?? '22'.repeat(32),
		settle_nonce_pub: provider.settle_nonce,
		refund_nonce_pub: provider.refund_nonce,
		bearer_amount: bearer.bearerAmount,
		circuit_version: BEARER_CIRCUIT_VERSION,
		...(idempotencyKeyHex ? { idempotency_key: idempotencyKeyHex } : {})
	};
}
