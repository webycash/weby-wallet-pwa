// Typed mirror of the extro-node WASM command surface.
//
// Source of truth: extro/extro-node/src/scheme402/command.rs
//   (`ExtroCommand` / `ExtroResponse` / `Op{Wallet,Scheme402,Hook,Push}`).
//
// This file is the *facade-level* shape only. It is NOT a generic Extro wire
// implementation — the rkyv encoding of these into the bytes `extro_node_send`
// expects lives in the bundled adapter (and is a deferred integration item; the
// mock adapter is the tested default). The exchange module always speaks these
// typed structures and never touches raw bytes directly.
//
// Secrecy law (mirrors the Rust doc): a `request_id` correlates every command
// to its response; response bodies are structured and NEVER carry a plaintext
// bearer secret unless the command is an explicit user-authorised export (none
// here return one).

export type RequestId = Uint8Array; // 16 bytes

// ── Wallet family selector (mirrors WireFamily) ──────────────────────────────

export type WireFamily =
	| 'Webcash'
	| 'Bitcoin'
	| 'Ark'
	| 'Voucher'
	| 'Rgb'
	| 'Pgp'
	| 'Vault';

// ── Op groups ────────────────────────────────────────────────────────────────

export type Op =
	| { kind: 'Wallet'; cmd: WalletCommand }
	| { kind: 'Scheme402'; cmd: Scheme402Command }
	| { kind: 'Hook'; cmd: HookCommand }
	| { kind: 'Push'; cmd: PushCommand }
	| { kind: 'Rail'; cmd: RailCommand };

export interface ExtroCommand {
	request_id: RequestId;
	/** rkyv-encoded capability token; `null`/`undefined` for same-realm callers. */
	cap_token?: Uint8Array | null;
	op: Op;
}

// ── Wallet commands (subset the exchange module needs) ───────────────────────

export type WalletCommand =
	| { op: 'DeriveIdentity'; slot: number }
	| {
			op: 'DeriveFamilyHandle';
			family: WireFamily;
			slot: number;
			index: number;
			/** `[contract_id, issuer_fingerprint_hex]` for Voucher/RGB; null otherwise. */
			namespace?: [string, string] | null;
	  }
	| { op: 'ListSummaries'; slot: number }
	| { op: 'Lock' };

// ── Expected-outcome selector (mirrors ExpectedOutcome) ──────────────────────

/**
 * Which outcome a mediated-conditional command must authorize. Selects the
 * conditional's domain tag at the trust boundary (mirrors extro-node
 * `ExpectedOutcome`): `Release` → ConditionalRelease, `Refund` →
 * ConditionalRefund, `Custom(label)` → Conditional(label). The wire payload
 * derives its own tag from its embedded outcome, so a release payload can only
 * open under the release tag and vice-versa — a single command can never cross
 * outcomes.
 */
export type ExpectedOutcome =
	| { kind: 'Release' }
	| { kind: 'Refund' }
	| { kind: 'Custom'; label: string };

// ── Scheme-402 commands ──────────────────────────────────────────────────────

export type Scheme402Command =
	| {
			op: 'SimplePay';
			slot: number;
			/** wire-form rail scheme, e.g. `"webcash"`, `"bitcoin_ark"`. */
			scheme: string;
			amount_raw: bigint;
			asset: string;
			pay_to: Uint8Array; // 20 bytes
			idempotency: Uint8Array; // 16 bytes
			inner: Uint8Array;
	  }
	| {
			op: 'AcceptEncryptedBearerDelivery';
			signed_delivery: Uint8Array;
			maker_vk: Uint8Array; // 32 bytes
			expected_recipient_fp: Uint8Array; // 20 bytes
	  }
	| { op: 'FailToDeliver'; signed_request: Uint8Array; signer_vk: Uint8Array }
	| { op: 'VerifyPaymentRequest'; signed_request: Uint8Array; payer_vk: Uint8Array }
	| {
			op: 'ConditionalVerify';
			signed_payload: Uint8Array;
			signer_vk: Uint8Array;
			expect_outcome: ExpectedOutcome;
	  };

// ── Hook commands ─────────────────────────────────────────────────────────────

export type HookCommand =
	| {
			op: 'Insert';
			signed_delivery: Uint8Array;
			maker_vk: Uint8Array;
			swap_id: Uint8Array; // 16 bytes
	  }
	| {
			op: 'Invalidate';
			signed_request: Uint8Array;
			signer_vk: Uint8Array;
			swap_id: Uint8Array;
	  }
	| {
			op: 'ReleaseConditional';
			signed_payload: Uint8Array;
			signer_vk: Uint8Array;
			expect_outcome: ExpectedOutcome;
	  };

// ── Push command ──────────────────────────────────────────────────────────────

/**
 * Which wallet hook an inbound push payload routes to (mirrors `PushKind`).
 * `ReleaseConditional` CARRIES the expected outcome, so this is a tagged union
 * (modeled like {@link ResponseBody}/{@link ExpectedOutcome}), not a bare
 * string — that object-vs-string shape is the encoding change the generalized
 * surface introduces.
 */
export type PushKind =
	| { kind: 'EncryptedDelivery' }
	| { kind: 'FailToDeliver' }
	| { kind: 'ReleaseConditional'; outcome: ExpectedOutcome };

export type PushCommand = {
	op: 'DispatchPush';
	kind: PushKind;
	signed_payload: Uint8Array;
	sender_vk: Uint8Array; // 32 bytes
	swap_id: Uint8Array; // 16 bytes
};

// ── Rail commands (Op::Rail — per-rail asset operations) ─────────────────────
//
// Source of truth: extro-node `src/scheme402/command.rs::RailCommand` and the
// `src/wasm/codec.rs::rail_from_js` Reflect mapping. These are the operations a
// family does NOT already expose (the receive address of every family is
// covered by {@link WalletCommand} `DeriveFamilyHandle`). The JS shape is
// `{op:'<Variant>', ...fields}`, wrapped as `op:{kind:'Rail', cmd:<this>}`.

/** Chain selector (mirrors `WireNetwork`). */
export type WireNetwork = 'Bitcoin' | 'Testnet' | 'Signet' | 'Regtest';

/**
 * Which RGB flavor a rail op targets (mirrors `WireRgbFlavor`): `Fungible` →
 * rgb20, `Collectible` → rgb21. Carried on every RGB issue/transfer/redeem op —
 * the codec REQUIRES it (`wire_rgb_flavor_from_js`).
 */
export type WireRgbFlavor = 'Fungible' | 'Collectible';

export type RailCommand =
	| {
			op: 'BitcoinBalance';
			slot: number;
			network: WireNetwork;
			/** Esplora base URL; empty ⇒ the network default. */
			esplora_url: string;
	  }
	| {
			op: 'BitcoinSend';
			slot: number;
			network: WireNetwork;
			/** Recipient address (validated for `network`). */
			to: string;
			/** Amount in satoshis (rides as a JS bigint; codec accepts u64). */
			amount_sat: bigint;
			/** Fee rate in sat/vByte. */
			fee_rate_sat_per_vb: bigint;
			esplora_url: string;
	  }
	| { op: 'VoucherBalance'; tokens: string[] }
	| {
			op: 'VoucherIssue';
			slot: number;
			server_url: string;
			/** Amount string for the minted voucher (e.g. `"50.0"`). */
			amount: string;
			/** Contract id (issuer-chosen series name). */
			contract: string;
			/** Idempotency nonce; empty ⇒ a fresh time-derived value. */
			nonce: string;
	  }
	| { op: 'VoucherTransfer'; server_url: string; input: string; recipient: string }
	| { op: 'VoucherRedeem'; server_url: string; secret: string }
	| { op: 'RgbBalance'; tokens: string[] }
	| {
			op: 'RgbIssue';
			slot: number;
			server_url: string;
			flavor: WireRgbFlavor;
			/** Amount string for the minted RGB20 token (ignored for RGB21). */
			amount: string;
			contract: string;
			nonce: string;
	  }
	| {
			op: 'RgbTransfer';
			server_url: string;
			flavor: WireRgbFlavor;
			input: string;
			recipient: string;
	  }
	| { op: 'RgbRedeem'; server_url: string; flavor: WireRgbFlavor; secret: string }
	| { op: 'RgbContracts'; tokens: string[] };

// ── Responses ─────────────────────────────────────────────────────────────────

export type HookOutcome = 'Processed' | 'Queued' | 'Duplicate';

/**
 * Stable error discriminants — the PascalCase variant names extro-node's codec
 * emits for the `code` field (mirrors extro-node `ErrorCode`; see
 * extro-node/src/scheme402/error.rs + src/wasm/codec.rs::error_code_name). Kept
 * open (`| string`) so a future code is still assignable before this union is
 * updated.
 */
export type ErrorCode =
	| 'MalformedCommand'
	| 'NotBooted'
	| 'PermissionDenied'
	| 'WalletLocked'
	| 'WalletError'
	| 'ShamirError'
	| 'SignatureInvalid'
	| 'PolicyRejected'
	| 'PayloadError'
	| 'Unsupported'
	| 'Internal'
	| 'ProofError'
	| 'StorageError'
	| string;

export type ResponseBody =
	| { kind: 'Empty' }
	| { kind: 'Identity'; fingerprint_hex: string; verifying_key: Uint8Array; slot: number }
	| { kind: 'FamilyHandle'; address: string; slot: number; index: number }
	| { kind: 'Summaries'; families: FamilySummary[] }
	| { kind: 'SignedRetry'; retry: Uint8Array; receipt_id: Uint8Array }
	| {
			kind: 'DeliveryAccepted';
			delivery_id: Uint8Array;
			recipient_fingerprint: Uint8Array;
			ciphertext_hash: Uint8Array;
	  }
	| {
			kind: 'PaymentRequestVerified';
			idempotency: Uint8Array; // 16 bytes
			amount_raw: bigint;
			asset_family: string;
			payee_fingerprint: Uint8Array; // 20 bytes
			accepts_referee: boolean;
	  }
	| {
			kind: 'ConditionalVerified';
			session_id: Uint8Array; // 16 bytes
			/** `"release"`, `"refund"`, or a custom outcome label. */
			outcome: string;
			referee_released: boolean;
	  }
	| { kind: 'Hook'; outcome: HookOutcome }
	// ── Rail response arms (see codec.rs response_body_to_js) ───────────────────
	| {
			kind: 'BitcoinBalance';
			address: string;
			/** Confirmed balance in sats (rides as bigint; codec emits BigInt). */
			confirmed_sats: bigint;
			/** Unconfirmed mempool delta in sats. */
			mempool_sats: bigint;
			/** Number of transactions touching the address. */
			tx_count: bigint;
	  }
	| {
			kind: 'BitcoinSent';
			/** Broadcast transaction id (hex). */
			txid: string;
			fee_sat: bigint;
			change_sat: bigint;
	  }
	| { kind: 'RailBalance'; groups: RailBalanceGroup[] }
	| {
			kind: 'RailIssued';
			/** Wire-form rail scheme, e.g. `"voucher"`, `"rgb20"`, `"rgb21"`. */
			scheme: string;
			contract: string;
			issuer_fp: string;
			/** The issued bearer secret (the PWA stores it). */
			secret: string;
	  }
	| { kind: 'RailTransferred'; scheme: string }
	| {
			kind: 'RailRedeemed';
			scheme: string;
			public_token: string;
			/** Whether the server reports the token on its books and unspent. */
			unspent: boolean;
	  }
	| { kind: 'RailContracts'; contracts: RailContract[] };

export interface FamilySummary {
	family: string;
	needs_namespace: boolean;
	address: string | null;
}

/**
 * One balance group, keyed by `(scheme, contract_id, issuer_fp)` (mirrors
 * `RailBalanceGroup`). RGB20/Voucher groups carry a summable `total`; RGB21
 * collectible groups carry a `count` (no per-item amount).
 */
export interface RailBalanceGroup {
	scheme: string;
	contract: string;
	issuer_fp: string;
	/** Item count in the group (rides as bigint; codec emits BigInt). */
	count: bigint;
	/** Summed amount string (canonical decimal); empty for count-only groups. */
	total: string;
}

/** One held contract namespace `(scheme, contract_id, issuer_fp)`. */
export interface RailContract {
	scheme: string;
	contract: string;
	issuer_fp: string;
}

export type ExtroResponse =
	| { kind: 'Ok'; request_id: RequestId; body: ResponseBody }
	| { kind: 'Err'; request_id: RequestId; code: ErrorCode; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Cryptographically-random 16-byte correlation id. */
export const newRequestId = (): RequestId => {
	const id = new Uint8Array(16);
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(id);
	else for (let i = 0; i < 16; i++) id[i] = Math.floor(Math.random() * 256);
	return id;
};

export const isOk = (r: ExtroResponse): r is Extract<ExtroResponse, { kind: 'Ok' }> =>
	r.kind === 'Ok';

/**
 * Stable outcome label for an {@link ExpectedOutcome} (mirrors the Rust
 * `ExpectedOutcome::label()`): `"release"` / `"refund"` / the custom label
 * verbatim.
 */
export const expectedOutcomeLabel = (o: ExpectedOutcome): string => {
	switch (o.kind) {
		case 'Release':
			return 'release';
		case 'Refund':
			return 'refund';
		case 'Custom':
			return o.label;
	}
};
