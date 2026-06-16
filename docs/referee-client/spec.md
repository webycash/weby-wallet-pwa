# webycash-referee-client — specification

This document specifies what `webycash-referee-client` does: the
extro-node primitives it consumes, the referee API it talks to, the
hooks it implements, and the user flows it presents. Implementation
lands when the [extro-node plugin system](extro-node-plugin-system.md) is
final.

## 1. Plugin identity

| Field | Value |
|---|---|
| Plugin name | `webycash-referee-client` |
| Plugin host domain | `weby.cash` (or a `*.weby.cash` subdomain dedicated to this plugin) |
| Plugin technology | WASM PWA (Rust → `wasm-bindgen` → service-worker + main-thread split) |
| Plugin manifest | See [`extro-node-plugin-system.md`](extro-node-plugin-system.md) §2 |
| Required extro-node version | `>= 1.x` (the version that ships the plugin RPC bridge) |
| Distribution | Static asset bundle served from `weby.cash`; plugin manifest URL pinned in extro-node's plugin registry |

## 2. Capabilities required from extro-node

The plugin requests the following capabilities at install time. The
user grants them once; revocation requires uninstall.

| Capability | What the plugin can do | Why it needs it |
|---|---|---|
| `pgp.identity.read` | Read the user's published PGP fingerprint and pubkey for one or more identities | Submit it as `parties.bob_pgp_fp` / `alice_pgp_fp` to the referee |
| `pgp.encrypt` | Encrypt a message to a third party's PGP pubkey | Build the `EncSec_B_to_A` ciphertext (Bob's webcash secret encrypted to Alice) |
| `pgp.decrypt` | Decrypt a message addressed to one of the user's PGP pubkeys | `insert_hook`: decrypt the incoming webcash secret. `release-settle` push: decrypt Alice's encrypted-to-Bob partial-sig |
| `pgp.sign` | Sign a canonical message with the user's PGP private key | Sign ack-receipts the push provider forwards back to the referee |
| `webcash.read` | Read the user's webcash secrets (just hashes + ownership, NOT cleartext) | Look up `H_B` for `invalidate_hook`; locate which secret corresponds to a hash for `/replace` |
| `webcash.replace` | Submit `/replace` calls to webcash.org for the user's owned secrets | Bob: invalidate via `invalidate_hook`. Alice: take ownership via `insert_hook` |
| `bip32.derive(family=webcash)` | Derive fresh wallet-owned secrets from the user's HD master | Fresh output secret on every `/replace` |
| `ark.read` | Read the user's vtxo state (which vtxos exist, current spending paths) | Surface candidate vtxos in the swap UI |
| `ark.musig2.session_begin` | Generate a fresh MuSig2 nonce-pair for one signing session, return the pubnonce | Round 1 of MuSig2 ceremony with the referee |
| `ark.musig2.partial_sign` | Produce the user's MuSig2 partial-sig for a given (session, message, counterparty pubshare, counterparty pubnonce) | Round 2 of MuSig2 ceremony |
| `ark.musig2.aggregate_and_broadcast` | Aggregate the user's partial + the referee's partial + broadcast on ARK | Settlement (Bob) or refund (Alice) |
| `ark.musig2.discard_session` | Drop the secret-nonce for an unused session | Forward-secrecy hygiene on terminal paths |
| `zkp.groth16.prove(circuit_id, witness, public_inputs)` | Generate a Groth16 proof for one of the bundled circuit IDs | Build `zkp_payload` (Bob) or `zkp_signature` (Alice) |
| `push.subscribe` | Register the user's PGP fingerprint with a push provider, receive push events to plugin-scoped handlers | Receive `insert_hook` / `invalidate_hook` / `release-settle` / `release-refund` deliveries |
| `http.fetch(referee_url)` | Make HTTPS calls to the referee's `/v1/*` endpoints | Drive `/v1/swap/initiate`, `/v1/swap/{id}/poll`, `/v1/swap/{id}/audit` |
| `storage.plugin_scoped` | Read/write a per-plugin sandboxed storage area | Persist swap-state-machine progress for crash recovery |

## 3. APIs the plugin calls

### 3.1 Referee (HTTPS, see [`referee/docs/api.md`](../../webycash-server/referee/docs/api.md))

| Endpoint | When | What |
|---|---|---|
| `GET /v1/pubkey` | First contact, then on every poll | Pin the referee's Ed25519 pubkey + MuSig2 pubshare in plugin-scoped storage |
| `POST /v1/swap/initiate` | When user confirms a swap | Submit both parties' encrypted payloads + ZKPs + Alice's nonce commitments. Synchronous: response = terminal outcome |
| `POST /v1/swap/{id}/poll` | UI status refresh, push-delivery delay fallback | Read current phase + last update time |
| `GET /v1/swap/{id}/audit` | "View audit trail" UI button | Read the full signed audit log for a swap |
| `POST /v1/swap/{id}/ack` | After an `insert_hook` / `invalidate_hook` push is fully processed | Forward a signed ack-receipt so the audit log records that the wallet handled the push |

### 3.2 Bearer-cash servers (HTTPS, indirectly via extro-node `webcash.replace` capability)

The plugin never calls webcash.org directly — extro-node's
`webcash.replace` capability handles that, audit-logged inside
extro-node. The plugin only requests "replace this hash to a fresh
self-owned secret" and consumes the typed result.

### 3.3 Extronet (read-only, optional)

If the user wants to find a counterparty via extronet (an offer board
hosted by extro-node), the plugin queries extro-node's `extronet.read`
capability (out of this plugin's spec — that's extro-node's surface).
Once the user picks a match, the plugin proceeds with `/v1/swap/initiate`.

If the user already has a counterparty (out-of-band negotiation), the
plugin skips extronet entirely.

## 4. Hooks the plugin implements

Both hooks are documented in
[`referee/docs/hook-contract.md`](../../webycash-server/referee/docs/hook-contract.md).
Wallet-implementor responsibilities below are how this plugin satisfies
that contract.

### 4.1 `insert_hook(pgp_pub, encrypted_payload, kind=Webcash)`

Called when the push provider delivers an `insert` push to one of the
user's PGP fingerprints. Plugin steps:

1. Verify the push payload's HMAC against the pinned push provider key
   (extro-node verifies; plugin trusts the verified flag).
2. Match `pgp_pub` against the user's PGP identities. If not ours, ack
   with `NotOurs` and short-circuit.
3. Call `pgp.decrypt(encrypted_payload, recipient_fp=pgp_pub)` via
   extro-node.
4. Validate the cleartext is a 32-byte secret whose `sha256` matches
   the swap's `H_B` (looked up by `swap_id` in plugin-scoped storage).
5. Derive a fresh self-owned secret via `bip32.derive(family=webcash)`.
6. Call `webcash.replace([their_secret], [my_new_secret])` via
   extro-node.
7. Persist outcome (`Replaced` / `AlreadySpent` / `InvalidPayload`) in
   plugin-scoped storage, keyed by `swap_id`.
8. Sign an ack-receipt with `pgp.sign` and POST to the referee's
   `/v1/swap/{id}/ack` endpoint.

Idempotency: dedup on `(swap_id, kind, sha256(encrypted_payload))`.
Repeats short-circuit at step 7's persisted outcome.

### 4.2 `invalidate_hook(public_hash)`

Called when the push provider delivers an `invalidate` push (typically
to Bob during the abort path). Plugin steps:

1. Verify HMAC + match the push to a swap_id in plugin-scoped storage.
2. Call `webcash.read` to find the secret backing `public_hash`. If not
   ours, ack `NotOurs` and short-circuit.
3. Derive a fresh self-owned secret via `bip32.derive(family=webcash)`.
4. Call `webcash.replace([old_secret], [my_new_secret])`.
5. Mark the original secret invalidated in plugin-scoped storage so a
   replay is a no-op.
6. Sign an ack-receipt and POST to `/v1/swap/{id}/ack`.

Critical UX point: this hook MUST run even if the user is offline or
the device is locked at the moment the push arrives. The plugin's
service-worker queues invalidates durably and replays on next online
moment; if the queue exceeds 24h, escalate to the user via
extro-node's notification surface.

### 4.3 `release-settle` push (recipient: Bob)

Plugin steps when Bob receives a `release-settle` push:

1. Decode the JSON payload: `{ referee_partial_sig, alice_enc_partial_sig }`.
2. Call `pgp.decrypt(alice_enc_partial_sig, recipient_fp=bob_pgp_fp)` to
   recover Alice's MuSig2 partial-sig.
3. Call `ark.musig2.aggregate_and_broadcast` with both partial-sigs +
   the swap's `tx_settle_hash` to broadcast `TX_settle` on ARK and claim
   the vtxo.
4. Persist `Settled` in plugin-scoped storage; surface success in UI.
5. Ack-receipt back to referee.

### 4.4 `release-refund` push (recipient: Alice)

Plugin steps when Alice receives a `release-refund` push:

1. Decode the cleartext payload: the referee's `TX_refund` partial-sig.
2. Look up Alice's locally-held `TX_refund` partial-sig (stored at swap
   init under the `swap_id` key in plugin-scoped storage).
3. Call `ark.musig2.aggregate_and_broadcast` with both partial-sigs +
   the swap's `tx_refund_hash` to broadcast `TX_refund` on ARK and
   refund the vtxo.
4. Persist `Refunded` in plugin-scoped storage; surface UI message
   explaining the refund (and probable cause).
5. Ack-receipt back to referee.

## 5. Swap state the plugin persists

Per swap, in plugin-scoped storage (capability `storage.plugin_scoped`):

```json
{
  "swap_id": "<uuid>",
  "role": "bob" | "alice",
  "phase_seen": "init" | "zkps-verified" | …,
  "h_b": "<64-hex>",
  "tx_settle_hash": "<64-hex>",
  "tx_refund_hash": "<64-hex>",
  "alice_partial_sig_refund_local": "<32-byte hex — alice role only>",
  "musig2_session_handles": {
    "settle": "<extro-node session id>",
    "refund": "<extro-node session id>"
  },
  "referee_pubkey_pinned": {
    "ed25519_pubkey_hex": "<64-hex>",
    "musig2_pubshare_hex": "<66-hex>",
    "fetched_at": "<rfc3339>"
  },
  "outcome": "settled" | "refunded" | null,
  "audit_chain_head_hex": "<32-hex>",
  "created_at": "<rfc3339>",
  "updated_at": "<rfc3339>"
}
```

The plugin never persists:

- Cleartext webcash secrets (extro-node's webcash store handles those).
- PGP private keys (extro-node holds those).
- MuSig2 secret nonces (extro-node holds those, keyed by the
  `musig2_session_handles`).

## 6. UI surface

See [`ui-flow.md`](ui-flow.md) for screen-by-screen detail. At a glance:

- **Initiate** — pick role (Bob webcash, Alice ARK) → enter counterparty
  PGP fingerprint or browse extronet → confirm amounts → submit.
- **Status** — live phase indicator (`init` → `zkps-verified` → … →
  `settled` / `refunded`) with explainer text per phase.
- **History** — list of past swaps with their audit-log links.
- **Recovery** — if the plugin was offline mid-swap, show pending swaps
  and let the user manually re-poll the referee or trigger
  retry-from-state.

## 7. Failure semantics

| Failure mode | Plugin behaviour |
|---|---|
| Push provider unreachable | Plugin polls `/v1/swap/{id}/poll` every 30s as fallback; UI shows "waiting for push" |
| Referee unreachable mid-swap | Show "referee offline" banner; let the user poll-retry; if pre-check happened but settle/refund didn't arrive, the user is at HTLC-timeout protection (UI explains) |
| extro-node revokes a capability mid-swap | Surface "permission revoked — swap may be stuck"; provide a safe "claim refund via extro-node directly" escape hatch |
| Plugin storage corrupted | Fall back to `/v1/swap/{id}/audit` to reconstruct phase; if audit log is also unreachable, user can call `/v1/swap/{id}/poll` and decide manually |
| ZKP proving fails locally | Show "ZKP generation failed — retry"; circuits run in WASM and may need more memory than the browser allocated |
| MuSig2 partial-sign rejected | Means the referee's pubnonces + our pubnonces don't match what was committed at init; abort the swap and surface the discrepancy |

## 8. Test strategy (when implementation lands)

| Test layer | What |
|---|---|
| Unit (Rust → wasm) | Pure logic: state machine, payload construction, ack-receipt signing |
| Integration in headless browser | postMessage RPC bridge against a mock extro-node host page |
| End-to-end with real referee | Spin a real `referee` binary + real `webycash-server-rgb` + a mock extro-node providing fake-but-shape-valid capabilities |
| End-to-end with real extro-node | Once extro-node ships its plugin runner, repeat e2e against the real host |

## 9. Versioning + backward compatibility

The plugin pins the referee's protocol version (currently `referee:v1`)
and refuses to talk to a referee advertising a different version on
`/v1/pubkey`. Plugin upgrades must coincide with referee upgrades;
mismatches surface as install-time errors.

The plugin's manifest declares its required extro-node version range.
extro-node refuses to install plugins targeting an unsupported range.

## 10. Out of scope (explicit)

- Migrating existing harmoniis-wallet swap state to this plugin.
- Bridging swaps across multiple referees (only one referee per swap).
- Cross-rail flows other than Webcash↔ARK (see `referee-zkp-based-swap.md` §1 — RGB↔X HTLC swaps don't use the referee and are handled by extro-node directly).
- Custodial fallback flows.
