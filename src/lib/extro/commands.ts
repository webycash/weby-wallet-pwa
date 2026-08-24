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
	| { kind: 'Rail'; cmd: RailCommand }
	| { kind: 'Keyserver'; cmd: KeyserverCommand }
	| { kind: 'Dhtx'; cmd: DhtxCommand };

// ── Dhtx commands (orderbook-on-DHTX; mirrors extro-node DhtxCommand) ─────────

/** Buy/sell side of a limit order (mirrors `WireSide`). */
export type WireSide = 'Buy' | 'Sell';

/** Asset-class trading pair (mirrors `WirePair`). */
export interface WirePair {
	base: string;
	quote: string;
}

/**
 * Orderbook-on-DHTX command group (mirrors extro-node `DhtxCommand`). The wallet
 * identity key signs the order INSIDE the WASM — the PWA only supplies the public
 * parameters. There is NO central order relay; orders ride DHTX peer-to-peer.
 */
export type DhtxCommand =
	/**
	 * Sign + record + broadcast a signed limit order to all connected 1-hop peers.
	 * Returns the order id and how many peers received it (`0` if no peer is
	 * connected). `price_atomic`/`amount_atomic` ride as JS bigints; `expires_at`
	 * is unix seconds (the order TTL).
	 */
	| {
			op: 'PublishOrder';
			slot: number;
			pair: WirePair;
			side: WireSide;
			price_atomic: bigint;
			amount_atomic: bigint;
			expires_at: number;
	  }
	/** Read the local order store for a pair (orders discovered from peers + own). */
	| { op: 'FetchOrders'; pair: WirePair }
	/** Re-broadcast this node's own live orders for a pair (maker keep-alive). */
	| { op: 'ReannounceOrders'; pair: WirePair }
	/**
	 * Taker → maker (the directed settle plane). Sign + send a `0x26` SwapMsg
	 * `Accept` carrying THIS node's bearer-seller identity to the maker. The
	 * taker's PGP pubkey + cancel pubkey are derived inside the WASM.
	 * `order_id`/`maker_fp` ride as fixed-length byte arrays (Uint8Array).
	 */
	| { op: 'SendSwapAccept'; slot: number; order_id: Uint8Array; maker_fp: Uint8Array }
	/**
	 * Maker → taker (the directed settle plane). Sign + send a `0x26` SwapMsg
	 * `Provider` carrying THIS node's REAL per-swap MuSig2 material + provider
	 * identity + ARK conditional references to the taker.
	 */
	| { op: 'SendProviderMaterial'; slot: number; order_id: Uint8Array; taker_fp: Uint8Array }
	/** Relay one verified canonical prepare signature to the other named party. */
	| {
			op: 'SendSwapPrepareSignature';
			slot: number;
			order_id: Uint8Array;
			for_fp: Uint8Array;
			role: 'Provider' | 'BearerSeller';
			signed_prepare: Uint8Array;
	  }
	/** Relay a referee-signed prepare allocation after verifying its pin/binding. */
	| {
			op: 'SendSwapPrepared';
			slot: number;
			order_id: Uint8Array;
			for_fp: Uint8Array;
			signed_response: Uint8Array;
			referee_vk: Uint8Array;
			expected_request_commitment: Uint8Array;
	  }
	/**
	 * Drain inbound swap messages, then read this node's swap inbox for an order:
	 * the Accept received as the maker and/or the Provider material received as
	 * the taker. Pull-on-drain (mirrors FetchOrders).
	 */
	| { op: 'FetchSwapMsgs'; order_id: Uint8Array };

// ── Keyserver commands (mirrors extro-node KeyserverCommand) ─────────────────

/**
 * Key-server identity + network-join surface (mirrors extro-node
 * `KeyserverCommand`). `Pin` anchors the server's `(fingerprint, vk)` out-of-band
 * (fail-closed, not TOFU); `Discover` fetches + verifies the server identity
 * record; `Bootstrap` joins the network via the WebRTC rendezvous
 * (`POST /.well-known/extro`, ADR-0001/0002).
 */
export type KeyserverCommand =
	| {
			op: 'Pin';
			base_url: string;
			domain: string;
			/** 40-hex key-server PGP fingerprint. */
			fingerprint_hex: string;
			/** 64-hex Ed25519 verifying key. */
			vk_hex: string;
	  }
	| { op: 'Discover'; base_url: string; domain: string }
	/**
	 * Join the network via the WebRTC rendezvous. The in-browser node opens an
	 * `RTCPeerConnection`, signs a `BootstrapRequest` with its slot-0 identity,
	 * posts it, fail-closed verifies the response against the pinned key-server
	 * anchor, and brings up the key-server DataChannel. **wasm-only** — the
	 * native node returns `Unsupported`. Connecting roster peers + walking the
	 * DHTX seeds is the later DHTX task; this brings up only the KS link.
	 */
	| { op: 'Bootstrap'; base_url: string; domain: string };

export interface ExtroCommand {
	request_id: RequestId;
	/** rkyv-encoded capability token; `null`/`undefined` for same-realm callers. */
	cap_token?: Uint8Array | null;
	op: Op;
}

// ── Wallet commands (subset the exchange module needs) ───────────────────────

export type WalletCommand =
	// Seed lifecycle. `Generate`/`Import` create a seed and transition the
	// extro-node MasterWallet to *Unlocked* (see extro-node wallet/master.rs
	// `generate`), returning the rkyv-sealed envelope; `Unlock` re-opens a
	// persisted envelope. `passphrase` seals the seed at rest.
	| { op: 'Generate'; passphrase: Uint8Array }
	| { op: 'Import'; mnemonic: string; passphrase: Uint8Array }
	| { op: 'Unlock'; sealed_seed: Uint8Array; passphrase: Uint8Array }
	| { op: 'DeriveIdentity'; slot: number }
	| {
			op: 'DeriveFamilyHandle';
			family: WireFamily;
			slot: number;
			index: number;
			/** `[contract_id, issuer_fingerprint_hex]` for Voucher/RGB; null otherwise. */
			namespace?: [string, string] | null;
			/** Address network for the Bitcoin family (drives the bech32 HRP:
			 * `tb1…` for Signet/Testnet, `bc1…` for mainnet). Omit/`null` →
			 * family default (mainnet). Non-bitcoin families ignore it. */
			network?: WireNetwork | null;
	  }
	| { op: 'ListSummaries'; slot: number }
	/** Public issuer identity (fingerprint + Ed25519 pubkey) for an
	 * issuer-namespaced family (Voucher/RGB) — register it on a rail server to
	 * become a recognized issuer. Public-only. */
	| { op: 'DeriveIssuer'; family: WireFamily; slot: number }
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

/** Canonical `extrolib::exchange::PrepareTerms` shape consumed by WASM. */
export interface ArkPrepareTerms {
	order_id: Uint8Array; // 32 bytes: 16 zero bytes + 16-byte DHTX id
	signed_order_commitment_sha256: Uint8Array; // 32 bytes
	fill_amount_raw: bigint;
	parties: {
		provider_fp: string;
		provider_pgp_pubkey_hex: string;
		bearer_seller_fp: string;
		bearer_seller_pgp_pubkey_hex: string;
		provider_musig2_pubkey: string;
		provider_cancel_pubkey_hex: string;
		bearer_seller_cancel_pubkey_hex: string;
	};
	provider_nonces: {
		settle_nonce_pub: string;
		refund_nonce_pub: string;
	};
	ark_network: 'regtest' | 'signet' | 'bitcoin';
	ark_operator_signer_pk: Uint8Array; // x-only, 32 bytes
	provider_ark_destination: string;
	bearer_seller_ark_destination: string;
	idempotency_key: Uint8Array; // 16 bytes
	nonce: Uint8Array; // 32 bytes
	expires_at_unix: number;
}

// ── Scheme-402 commands ──────────────────────────────────────────────────────

export type Scheme402Command =
	/** Emit the provider's MuSig2 material (pubkey + settle/refund nonces) for a swap. */
	| { op: 'ProviderMaterial'; slot: number; swap_id: string }
	| { op: 'SignSwapPrepare'; slot: number; terms: ArkPrepareTerms }
	| { op: 'CountersignSwapPrepare'; slot: number; counterparty_signed: Uint8Array }
	| {
			op: 'BuildSwapPrepareRequest';
			provider_signed: Uint8Array;
			bearer_seller_signed: Uint8Array;
	  }
	| {
			op: 'VerifySwapPrepared';
			signed_response: Uint8Array;
			referee_vk: Uint8Array;
			expected_request_commitment: Uint8Array;
			now_unix: number;
	  }
	/** Cache the Groth16 proving keys for in-wasm SwapInitiate. */
	| { op: 'InstallProofKeys'; bearer_pk: Uint8Array; conditional_pk: Uint8Array }
	/** Build the two-proof /v1/swap/initiate envelope in-wasm. `facts` is TwoProofFacts. */
	| { op: 'SwapInitiate'; facts: unknown }
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
	| { op: 'RgbContracts'; tokens: string[] }
	| {
			/**
			 * Mint a webcash to the wallet's webcash-family scalar at (slot 0, index)
			 * on the live webcash server — the bearer-custody bridge that lets an
			 * in-browser 402 swap's bearer leg settle. `index` must be < 64 (the
			 * bearer secret source's scan gap). The minted secret's
			 * H = SHA-256(hex(scalar)) is the H the swap proves against and the
			 * referee /health_check checks.
			 */
			op: 'MintWebcash';
			/** Webcash-family index at slot 0; must be < 64. */
			index: number;
			/** Amount string for the minted webcash (e.g. `"1.0"`). Not part of H. */
			amount: string;
			/** Webcash-server base URL (e.g. `"http://localhost:8181"`). */
			server_url: string;
	  };

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
	| { kind: 'Issuer'; fingerprint: string; pubkey_hex: string }
	| { kind: 'Summaries'; families: FamilySummary[] }
	| { kind: 'SignedRetry'; retry: Uint8Array; receipt_id: Uint8Array }
	| { kind: 'ProviderMaterial'; musig2_pubkey: string; settle_nonce: string; refund_nonce: string }
	| { kind: 'SwapPrepareSigned'; signed: Uint8Array; request_commitment: Uint8Array }
	| { kind: 'SwapPrepareEnvelope'; bytes: Uint8Array }
	| {
			kind: 'SwapPrepared';
			swap_id: string;
			request_commitment: Uint8Array;
			referee_musig2_pubshare: string;
			referee_settle_nonce_pub: string;
			referee_refund_nonce_pub: string;
			expires_at_unix: bigint;
	  }
	| { kind: 'ProofKeysInstalled' }
	| { kind: 'InitiateEnvelope'; bytes: Uint8Array }
	// ── Dhtx orderbook response arms (mirrors extro-node ResponseBody) ──────────
	| {
			/** A signed limit order was published into the node network. */
			kind: 'OrderPublished';
			order_id: Uint8Array; // 16 bytes
			/** How many connected peers received the OrderAnnounce broadcast. */
			peers_broadcast: number;
	  }
	| {
			/** Verified public-commitment orders discovered from the network. */
			kind: 'Orders';
			orders: WireOrder[];
	  }
	| {
			/** This node's own live orders were re-broadcast. */
			kind: 'Reannounced';
			peers_broadcast: number;
	  }
	| {
			/** A directed swap message was sent; `delivered` = reached a peer. */
			kind: 'SwapMsgSent';
			delivered: boolean;
	  }
	| {
			/** The directed swap bodies that have arrived for an order. */
			kind: 'SwapMsgs';
			accept: WireAccept | null;
			provider: WireProviderMaterial | null;
			provider_prepare: Uint8Array | null;
			bearer_seller_prepare: Uint8Array | null;
			prepared_response: Uint8Array | null;
	  }
	| { kind: 'KeyserverPinned' }
	| { kind: 'Discovered'; fingerprint_hex: string; verified: boolean }
	| {
			/**
			 * A completed network-bootstrap join. Redacted summary only — never
			 * the SDP answer, ICE secrets, or seed payloads (those stay inside
			 * the transport/DHTX layer).
			 */
			kind: 'Bootstrapped';
			/** Number of peer offers the server forwarded in the roster. */
			roster_count: number;
			/** Number of DHTX seeds the server returned. */
			dhtx_seeds_count: number;
			/** Number of interest seeds the server returned. */
			interest_seeds_count: number;
			/** Number of roster/seed peers whose DataChannel reached Open. */
			peers_connected: number;
			/** Whether the key-server DataChannel reached the `Open` state. */
			connected: boolean;
	  }
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
	| { kind: 'RailContracts'; contracts: RailContract[] }
	| {
			/**
			 * A minted webcash now held by the wallet's webcash-family scalar and
			 * (when `unspent`) on the live server's books — the bearer-custody
			 * bridge that unblocks an in-browser 402 swap's bearer leg.
			 */
			kind: 'WebcashMinted';
			/** The minted bearer secret token (`e{amount}:secret:{hex(scalar)}`). */
			secret: string;
			/** The `/health_check` lookup token (`e{amount}:public:{H}`). */
			public_token: string;
			/** Webcash-family index the scalar was minted at (slot 0). */
			index: number;
			/** Whether the server reports the minted token unspent (mint confirmed). */
			unspent: boolean;
	  };

export interface FamilySummary {
	family: string;
	needs_namespace: boolean;
	address: string | null;
}

/**
 * Public projection of a received taker `Accept` (maker side) — mirrors
 * extro-node `WireAccept`. Bytes ride as `Uint8Array`; hex fields as strings.
 */
export interface WireAccept {
	order_id: Uint8Array; // 16 bytes
	bearer_seller_fp: Uint8Array; // 20 bytes
	bearer_seller_pgp_pubkey: Uint8Array;
	bearer_seller_cancel_pubkey_hex: string;
}

/**
 * Public projection of received maker `Provider` material (taker side) — mirrors
 * extro-node `WireProviderMaterial`. All public; no secret crosses. The MuSig2
 * pubkey + nonces are REAL (derived from the maker's ARK scalar for the swap).
 */
export interface WireProviderMaterial {
	order_id: Uint8Array; // 16 bytes
	provider_fp: Uint8Array; // 20 bytes
	provider_pgp_pubkey: Uint8Array;
	provider_musig2_pubkey: string;
	settle_nonce_pub: string;
	refund_nonce_pub: string;
	provider_cancel_pubkey_hex: string;
	locked_ref: string;
	tx_settle_hash_hex: string;
	tx_refund_hash_hex: string;
}

/**
 * Public projection of a node-side `LiveOrder` (mirrors extro-node `WireOrder`) —
 * exactly the fields the exchange `LimitOrder` needs, never a secret. The codec
 * emits `order_id`/`maker_fp`/`maker_vk`/`signed_commitment` as `Uint8Array`,
 * `price_atomic`/`amount_atomic`/`expires_at`/`observed_at` as JS `bigint`.
 */
export interface WireOrder {
	order_id: Uint8Array; // 16 bytes
	pair: WirePair;
	side: WireSide;
	price_atomic: bigint;
	amount_atomic: bigint;
	maker_fp: Uint8Array; // 20 bytes
	maker_vk: Uint8Array; // 32 bytes
	expires_at: bigint;
	observed_at: bigint;
	signed_commitment: Uint8Array;
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
