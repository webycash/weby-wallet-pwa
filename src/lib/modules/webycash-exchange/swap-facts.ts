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

import { getExtroClient } from "$lib/extro";
import { newRequestId, type SwapFactsInput } from "@extro/node";
import type { ExtroSend } from "./exchange-core";
import type { LimitOrder } from "./types";

/** Fixed conditional-leg witness length (extro_circuits::CONDITIONAL_WITNESS_LEN). */
export const CONDITIONAL_WITNESS_LEN = 128;

/** The bearer-payload circuit version the deployed referee selects its 6-input VK by. */
export const BEARER_CIRCUIT_VERSION = "bearer_payload.v2";

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
  /** Settlement sighash(es) the conditional binding pins (32·N-byte hex, sighash-bundle-v1). */
  tx_settle_hash_hex: string;
  /** Refund sighash(es) (32·N-byte hex). */
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

/**
 * The verified `/v1/swap/prepare` allocation that every initiate MUST name.
 * `requestCommitment` is SHA-256 of the byte-identical `PrepareTerms` body both
 * parties signed; `idempotencyKey` is copied from those same terms.
 */
export interface PreparedSwapBinding {
  swapId: string;
  requestCommitment: Uint8Array; // 32
  idempotencyKey: Uint8Array; // 16
  expiresAtUnix: bigint;
}

/** The TwoProofFacts JS object the prover passes straight to `SwapInitiate`. */
export interface TwoProofFacts {
  prepared_swap_id: string;
  prepare_request_commitment: Uint8Array; // 32
  asset: { family: "BitcoinArk" };
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
  tx_settle_hash: Uint8Array; // 32·N (sighash-bundle-v1: [checkpoint, ark])
  tx_refund_hash: Uint8Array; // 32·N, same N as tx_settle_hash
  provider_musig2_pubkey: string;
  provider_cancel_pubkey_hex: string;
  bearer_seller_cancel_pubkey_hex: string;
  settle_nonce_pub: string;
  refund_nonce_pub: string;
  bearer_amount: string;
  circuit_version: string;
  idempotency_key: string;
}

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0)
    throw new Error(`odd-length hex (${clean.length})`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Parse a Webcash family-handle address `e{amount}:public:{H}` into its decimal
 * amount + the 32-byte `H`. Throws if the address is not a Webcash public handle.
 */
export function parseWebcashHandle(address: string): {
  amount: string;
  hash: Uint8Array;
} {
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
  fillAmountRaw?: bigint,
): Promise<BearerLeg> {
  const client = getExtroClient();
  const res = await client.send({
    request_id: newRequestId(),
    op: {
      kind: "Wallet",
      cmd: {
        op: "DeriveFamilyHandle",
        family: "Webcash",
        slot,
        index,
        namespace: null,
      },
    },
  });
  if (res.kind === "Err")
    throw new Error(`DeriveFamilyHandle(Webcash): ${res.message}`);
  if (res.body.kind !== "FamilyHandle") {
    throw new Error(`DeriveFamilyHandle(Webcash): unexpected ${res.body.kind}`);
  }
  const { amount, hash } = parseWebcashHandle(res.body.address);
  return {
    publicTokenHash: hash,
    bearerAmount: amount,
    fillAmountRaw: fillAmountRaw ?? BigInt(amount),
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
  /** Referee-signed allocation verified against the runtime-pinned referee key. */
  prepared: PreparedSwapBinding;
  /**
   * The provider fingerprint the dual-signed prepare terms name. Required when
   * the TAKER provides Ark (the maker is then the bearer seller); defaults to
   * the order maker.
   */
  expectedProviderFpHex?: string;
}

/** Map the wallet's builder input onto extro-node's `SwapFactsInput` (shape only, no rules). */
export function swapFactsOpInput(input: BuildFactsInput): SwapFactsInput {
  // Absent or mistyped values become empty ones so extro-node reports the
  // same first-failing check the wallet used to (no rules here).
  const str = (x: unknown): string => (typeof x === "string" ? x : "");
  const bytes = (x: unknown): Uint8Array =>
    x instanceof Uint8Array ? x : new Uint8Array(0);
  const int = (x: unknown): bigint => (typeof x === "bigint" ? x : 0n);
  const { order, bearer, provider, bearerSeller, encSecretForProvider } = input;
  const prepared: Partial<PreparedSwapBinding> = input.prepared ?? {};
  const p = provider ?? ({} as Partial<ProviderMaterial>);
  const s = bearerSeller ?? ({} as Partial<BearerSellerIdentity>);
  return {
    order_id_hex: str(order?.id),
    maker_fp_hex: str(order?.makerFingerprint),
    public_token_hash: bytes(bearer?.publicTokenHash),
    bearer_amount: str(bearer?.bearerAmount),
    fill_amount_raw: int(bearer?.fillAmountRaw),
    provider: {
      musig2_pubkey: str(p.musig2_pubkey),
      settle_nonce: str(p.settle_nonce),
      refund_nonce: str(p.refund_nonce),
      provider_fp: str(p.provider_fp),
      provider_pgp_pubkey: str(p.provider_pgp_pubkey),
      provider_cancel_pubkey_hex: str(p.provider_cancel_pubkey_hex),
      locked_ref: str(p.locked_ref),
      tx_settle_hash_hex: str(p.tx_settle_hash_hex),
      tx_refund_hash_hex: str(p.tx_refund_hash_hex),
      conditional_payload: bytes(p.conditional_payload),
    },
    bearer_seller: {
      bearer_seller_fp: str(s.bearer_seller_fp),
      bearer_seller_pgp_pubkey: str(s.bearer_seller_pgp_pubkey),
      bearer_seller_cancel_pubkey_hex: str(s.bearer_seller_cancel_pubkey_hex),
    },
    enc_secret_for_provider: bytes(encSecretForProvider),
    prepared_swap_id: str(prepared.swapId),
    prepare_request_commitment: bytes(prepared.requestCommitment),
    idempotency_key: bytes(prepared.idempotencyKey),
    expires_at_unix: int(prepared.expiresAtUnix),
    ...(typeof input.expectedProviderFpHex === "string"
      ? { expected_provider_fp_hex: input.expectedProviderFpHex }
      : {}),
  };
}

/**
 * Assemble {@link TwoProofFacts} from a selected order, the wallet bearer leg,
 * and the provider's MuSig2 material.
 *
 * All fields must come from the authenticated order/Accept exchange, the two
 * wallets, and the prepared Ark contract. This function checks wire shape and
 * cross-field identity binding. It cannot establish that opaque bytes are a
 * decryptable ciphertext; the wallet encryption API and ZKP must establish
 * that separately before Gate 3 can be enabled.
 *
 * The checks and assembly live in extro-node (`Op::Exchange SwapFacts`,
 * ADR-0007); a refusal throws `SWAP_FACTS_INVALID: <reason>`.
 */
export async function buildSwapInitiateFacts(
  input: BuildFactsInput,
  send: ExtroSend = (c) => getExtroClient().send(c),
): Promise<TwoProofFacts> {
  const res = await send({
    request_id: newRequestId(),
    op: {
      kind: "Exchange",
      cmd: { op: "SwapFacts", input: swapFactsOpInput(input) },
    },
  });
  if (res.kind === "Err") throw new Error(res.message);
  if (res.body.kind !== "ExchangeSwapFacts") {
    throw new Error(`SwapFacts: unexpected ${res.body.kind}`);
  }
  return res.body.facts as TwoProofFacts;
}
