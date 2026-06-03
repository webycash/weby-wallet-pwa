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
	| { kind: 'Push'; cmd: PushCommand };

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
	| { op: 'OrderRequest'; signed_request: Uint8Array; taker_vk: Uint8Array }
	| { op: 'ArkVerifySettle'; signed_payload: Uint8Array; signer_vk: Uint8Array }
	| { op: 'ArkVerifyRefund'; signed_payload: Uint8Array; signer_vk: Uint8Array };

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
	| { op: 'ReleaseSettle'; signed_payload: Uint8Array; signer_vk: Uint8Array }
	| { op: 'ReleaseRefund'; signed_payload: Uint8Array; signer_vk: Uint8Array };

// ── Push command ──────────────────────────────────────────────────────────────

export type PushKind = 'EncryptedDelivery' | 'FailToDeliver' | 'ArkSettle' | 'ArkRefund';

export type PushCommand = {
	op: 'DispatchPush';
	kind: PushKind;
	signed_payload: Uint8Array;
	sender_vk: Uint8Array; // 32 bytes
	swap_id: Uint8Array; // 16 bytes
};

// ── Responses ─────────────────────────────────────────────────────────────────

export type HookOutcome = 'Processed' | 'Queued' | 'Duplicate';

/** Stable error discriminants (mirrors extro-node `ErrorCode`). */
export type ErrorCode =
	| 'NotBooted'
	| 'MalformedCommand'
	| 'PermissionDenied'
	| 'VerificationFailed'
	| 'PairRejected'
	| 'Internal'
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
			kind: 'OrderVerdict';
			allowed: boolean;
			settlement_model: string;
			requires_referee: boolean;
	  }
	| { kind: 'ArkVerified'; session_id: Uint8Array; outcome: 'settle' | 'refund'; referee_released: boolean }
	| { kind: 'Hook'; outcome: HookOutcome };

export interface FamilySummary {
	family: string;
	needs_namespace: boolean;
	address: string | null;
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
