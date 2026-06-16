# extro-node plugin system — proposed architecture

This document proposes how the **extro-node plugin system** should work,
using `webycash-referee-client` as the canonical first plugin. It's a
proposal, not a final spec — extro-node hasn't shipped its plugin
runner yet, and the right shape will be settled by the team building
extro-node. The goal of this document is to give them concrete
requirements (driven by a real plugin's needs) so the runner is
designed to fit, not retrofitted afterwards.

## 1. Why a plugin system

extro-node already ships:

- PGP identity management
- Bitcoin ARK keys + vtxo state
- Webcash HD master + secret store
- BIP32 derivation
- An extronet client (offers + bids)
- Push subscription primitives

What it does NOT ship is **swap-protocol-specific logic** like:

- The webycash referee-ZKP-based swap state machine (this plugin)
- A future Harmoniis license-marketplace bidder UI
- Third-party HTLC swap drivers (e.g. RGB ↔ ARK direct)
- Niche cross-rail integrations (e.g. ARK ↔ Lightning)

Each of those needs its own state machine, UI, and protocol-specific
crypto sequencing — but all of them want the SAME core capabilities
(PGP, MuSig2, ARK, webcash, push). A plugin system lets extro-node
ship the core and the long tail of protocols ship as plugins.

The win:

- One vetted source of cryptographic primitives.
- One audited key store, one backup scheme, one recovery flow.
- Per-plugin capability scoping so a buggy / malicious plugin can't
  exfiltrate keys or sign arbitrary messages.
- Independent upgrade cadence: a plugin can ship daily without the
  user re-confirming their seed phrase.

## 2. Plugin manifest

Every plugin ships a manifest at a stable URL (`{plugin_origin}/.well-known/extro-plugin.json`). The manifest is the single source of
truth for what the plugin needs:

```json
{
  "manifest_version": 1,
  "id": "webycash-referee-client",
  "version": "0.1.0",
  "name": "Webycash ↔ Bitcoin ARK swap",
  "description": "Drive a referee-mediated cross-rail swap between webcash and a Bitcoin ARK vtxo.",
  "author": "<author identity>",
  "author_pgp_fp": "<40-hex>",
  "author_signature_url": "https://weby.cash/.well-known/extro-plugin.sig",

  "host": "weby.cash",
  "entry_url": "https://weby.cash/plugin/index.html",
  "service_worker_url": "https://weby.cash/plugin/sw.js",

  "min_extro_node_version": "1.0",
  "max_extro_node_version": "2.0",

  "capabilities_required": [
    {
      "name": "pgp.identity.read",
      "scope": "all",
      "rationale": "Display the user's PGP fingerprint as 'me' in the swap form."
    },
    {
      "name": "pgp.decrypt",
      "scope": "any",
      "rationale": "Decrypt incoming insert_hook payloads."
    },
    {
      "name": "ark.musig2.partial_sign",
      "scope": "session-bound",
      "rationale": "Sign settlement and refund partial-sigs for one swap at a time."
    }
    /* … the rest per docs/spec.md §2 … */
  ],

  "push_handlers": [
    { "event_kind": "insert", "handler": "/plugin/handlers/insert.js" },
    { "event_kind": "invalidate", "handler": "/plugin/handlers/invalidate.js" },
    { "event_kind": "release-settle", "handler": "/plugin/handlers/release_settle.js" },
    { "event_kind": "release-refund", "handler": "/plugin/handlers/release_refund.js" }
  ],

  "ui_entry_points": [
    { "label": "Swap webcash for ARK", "icon": "/plugin/icon.svg", "path": "/plugin/swap" }
  ],

  "audit": {
    "user_visible_actions": ["initiate-swap", "settle", "refund", "invalidate-secret"],
    "default_consent_policy": "ask-once-per-action"
  }
}
```

The author signature (`author_signature_url`) is a detached PGP
signature over the canonical JSON of this manifest. extro-node verifies
it against `author_pgp_fp` at install time.

## 3. Capability model

A capability has three properties:

- **Name** — stable string from extro-node's published capability
  vocabulary (e.g. `pgp.decrypt`, `ark.musig2.partial_sign`).
- **Scope** — the bounding context for grants:
  - `all` — global; grants apply to every call.
  - `any` — granted on each call (e.g. PGP decrypt on a specific
    ciphertext requires explicit user OK).
  - `session-bound` — scoped to a session id created by the plugin;
    extro-node tags every operation with the session and refuses to
    cross-pollinate.
- **Rationale** — human-readable text shown to the user at install +
  consent prompts.

extro-node maintains a per-plugin grant table:

```
{ plugin_id, capability, scope, granted_at, expires_at?, scope_id? }
```

Revocation by the user clears matching rows. Plugins polling for a
revoked capability get a typed `RevokedByUser` error, NOT a silent
denial.

### Capability vocabulary (proposed minimal set)

| Capability | Scope | What it allows |
|---|---|---|
| `pgp.identity.read` | all | Read user's PGP fingerprints + pubkeys |
| `pgp.encrypt` | any | Encrypt a message to a third-party pubkey |
| `pgp.decrypt` | any | Decrypt a ciphertext addressed to one of user's pubkeys |
| `pgp.sign` | any | Sign a canonical message with one of user's PGP keys |
| `webcash.read` | all | Read user's webcash hashes + ownership (NOT cleartext) |
| `webcash.replace` | any | Submit a `/replace` for one of user's owned secrets |
| `bip32.derive(family=…)` | all | Derive fresh secrets in the named family |
| `ark.read` | all | Read user's vtxo state |
| `ark.musig2.session_begin` | any | Begin a fresh MuSig2 session |
| `ark.musig2.partial_sign` | session-bound | Produce a partial-sig in a session |
| `ark.musig2.aggregate_and_broadcast` | session-bound | Aggregate + broadcast a tx |
| `ark.musig2.discard_session` | session-bound | Drop secret nonces |
| `zkp.groth16.prove(circuit_id=…)` | any | Generate a proof for a bundled circuit |
| `push.subscribe` | all | Register handlers for push events |
| `http.fetch(origin=…)` | all | HTTPS GET/POST to one named origin (NOT *.) |
| `storage.plugin_scoped` | all | Per-plugin sandboxed key-value store |
| `extronet.read` | all | Read the user's extronet feed (offers, bids) |

The capability list is a **closed enum** — plugins cannot request
capabilities outside this vocabulary. Adding a new capability is a
deliberate extro-node release.

## 4. Cross-domain RPC bridge

extro-node lives on `extro.network`; a plugin lives on its own host
(e.g. `weby.cash`). The plugin runs in an iframe (or its own popup
window) that extro-node embeds. Communication is via `postMessage`
with a typed RPC framing.

### 4.1 Wire framing

Every message is a JSON envelope:

```json
{
  "rpc_version": 1,
  "kind": "request" | "response" | "event" | "error",
  "id": "<uuid>",
  "in_reply_to": "<uuid>",   // present on response/error
  "method": "pgp.decrypt",   // present on request
  "args": { … },
  "result": { … },           // present on response
  "error": { "kind": "…", "message": "…" }   // present on error
}
```

extro-node is the **server** in this RPC: the plugin makes requests,
extro-node responds. Events flow the other way (e.g. push deliveries,
capability-revocation notifications).

### 4.2 Authentication

The first message in each RPC session is a handshake:

```
plugin → extro-node: {
  "kind": "request",
  "method": "_handshake",
  "args": {
    "manifest_url": "https://weby.cash/.well-known/extro-plugin.json",
    "manifest_sha256": "<hex>",
    "session_pubkey": "<plugin-generated session pubkey>"
  }
}
```

extro-node:

1. Fetches the manifest URL.
2. Verifies the manifest's PGP signature against the cached author fp.
3. Compares `manifest_sha256` to the plugin's own claim (mismatch =
   abort).
4. Returns a session token signed with extro-node's session key.

Subsequent calls carry `auth: <session_token>` in the envelope. Mismatch
= immediate session termination.

### 4.3 Method semantics

Each capability maps to one or more RPC methods:

```
pgp.decrypt:
  args  = { recipient_fp, ciphertext_bytes, scope: "any" | "session-bound" }
  result = { cleartext_bytes }

ark.musig2.session_begin:
  args  = { swap_id, session_label }
  result = { session_id, pub_nonce_hex }

ark.musig2.partial_sign:
  args  = { session_id, message_hash_hex, counterparty_pubshare_hex, counterparty_pubnonce_hex }
  result = { partial_sig_hex }

push.subscribe:
  args  = { handlers: [{ event_kind, handler_url }] }
  result = { subscription_id }
```

Full method catalogue is built incrementally as plugins request more
capabilities. Each addition is reviewed by extro-node maintainers
against the security implications.

### 4.4 User consent prompts

When a plugin invokes an `any`-scope or `session-bound`-scope method
that has not been pre-granted, extro-node interrupts with a consent
modal:

```
┌──────────────────────────────────────────────────────────────────┐
│ Webycash ↔ Bitcoin ARK swap (webycash-referee-client)             │
│                                                                   │
│ Wants to: decrypt an incoming PGP message addressed to your       │
│           webycash identity                                       │
│                                                                   │
│ Reason:   Receive an incoming webcash secret as part of an        │
│           in-progress swap (#a1b2c3…)                             │
│                                                                   │
│ Sender:   <referee.example>                                       │
│                                                                   │
│ ┌─────────────────────┬──────────────────────┐                   │
│ │ Allow once          │ Deny                 │                   │
│ ├─────────────────────┼──────────────────────┤                   │
│ │ Allow for this swap │ Always allow         │                   │
│ └─────────────────────┴──────────────────────┘                   │
└──────────────────────────────────────────────────────────────────┘
```

User picks; extro-node records the grant in its grant table; the call
proceeds (or errors with `DeniedByUser`).

For `all`-scope capabilities (e.g. `pgp.identity.read`), the consent
happens once at install time; subsequent calls don't prompt.

## 5. Plugin lifecycle

| Phase | What happens |
|---|---|
| **Install** | User pastes manifest URL or picks from a curated catalogue. extro-node fetches manifest, verifies signature, displays capability list + rationales, asks for consent. On approval, plugin is added to the user's plugin registry. |
| **Run** | User clicks one of the plugin's `ui_entry_points`. extro-node opens the plugin's `entry_url` in an iframe (or popup), establishes the RPC bridge, dispatches the entry-point. |
| **Push delivery** | Push provider posts to extro-node's webhook endpoint. extro-node looks up which plugin owns the recipient PGP fingerprint × event_kind. Routes to the plugin's registered `push_handlers[*].handler`. The handler runs in a service-worker scope (no UI required); can call back into extro-node via the RPC bridge. |
| **Background tasks** | Plugins schedule periodic tasks (e.g. poll a referee URL). extro-node enforces a quota (max 1 background callback per plugin per 30 seconds) and logs every invocation. |
| **Uninstall** | User clicks "uninstall". extro-node revokes all grants, drops plugin-scoped storage, clears push handlers, closes any open iframes. The plugin's hosted assets remain at `weby.cash` but the user's wallet no longer talks to them. |

## 6. Security boundaries

### 6.1 What the plugin CAN see

- Its own iframe DOM.
- Responses to its RPC calls (scoped by granted capabilities).
- Push events delivered to its registered handlers.
- Its own plugin-scoped storage.

### 6.2 What the plugin CANNOT see

- Other plugins' storage.
- The user's PGP private keys, BIP32 master secret, ARK secret keys —
  these never leave extro-node's process. The plugin only ever sees
  *operation results* (decrypted text, signatures, derived public material).
- Capabilities it didn't request, regardless of what extro-node has.
- The user's full webcash secret store (only specific hashes it asks
  about, gated by consent).

### 6.3 What extro-node enforces at the bridge

- Method whitelist per granted capabilities.
- Per-call rate limits (e.g. max 10 `pgp.decrypt` calls per second per
  plugin).
- Argument validation (e.g. every `recipient_fp` must match the user's
  registered fingerprints).
- Audit log of every method call: `{plugin_id, method, args_hash,
  caller_user, result_status, ts}`. User can inspect this log under
  extro-node's settings.

### 6.4 Sandbox escape considerations

- Iframes use `sandbox="allow-scripts"` (no `allow-same-origin`,
  preventing cookie/storage access on extro-node's domain).
- Service workers for push handlers run in the plugin's own origin,
  not extro-node's.
- WASM in the plugin runs with the browser's standard WASM sandbox; no
  shared linear memory with extro-node.
- The RPC bridge uses Content Security Policy + `targetOrigin` checks
  on every postMessage.

## 7. Audit + transparency

extro-node maintains a per-user audit log:

```
{ plugin_id, ts, method, args_summary, granted_via, outcome }
```

User-visible at any time. A user investigating "why did this swap
fire" can follow:

1. Plugin's local audit (in plugin storage).
2. extro-node's bridge audit (which calls the plugin made).
3. Referee's signed audit log (what the server saw).
4. Webcash.org's `/health_check` (independent ground-truth).

Four independent records, all timestamped, all cross-linked by
`swap_id`.

## 8. Use case walkthrough — webycash-referee-client

Concrete instantiation of all the above:

### 8.1 Install

1. User pastes `https://weby.cash/.well-known/extro-plugin.json` into
   extro-node's "add plugin" dialog.
2. extro-node fetches manifest, verifies PGP signature.
3. Shows capability list (per `spec.md §2`):
   - `pgp.identity.read` — read fingerprint
   - `pgp.encrypt` / `pgp.decrypt` / `pgp.sign`
   - `webcash.read` / `webcash.replace`
   - `bip32.derive(family=webcash)`
   - `ark.read` / `ark.musig2.*`
   - `zkp.groth16.prove(circuit_id=webycash_payload)` and
     `(circuit_id=webycash_signature)`
   - `push.subscribe`
   - `http.fetch(origin=https://referee.weby.cash)`
   - `storage.plugin_scoped`
4. User clicks "install + grant".

### 8.2 Initiate swap (Bob role — selling webcash for ARK)

1. User opens "Swap webcash for ARK" from extro-node's plugin tray.
2. extro-node opens `https://weby.cash/plugin/swap` in an iframe.
3. Plugin asks extro-node:
   - `pgp.identity.read` → returns Bob's fp + pubkey.
   - `webcash.read({contract_id: …, issuer: …})` → returns hashes + amounts.
4. UI shows "you have X webcash; pick a counterparty".
5. User pastes Alice's PGP pubkey.
6. Plugin asks extro-node:
   - `bip32.derive(family=webcash, index=N+1)` → fresh self-secret.
   - `pgp.encrypt(recipient=alice_pubkey, plaintext=S_B_old)` → ciphertext.
   - `zkp.groth16.prove(circuit_id=webycash_payload, witness=…, public_inputs=…)` → proof.
7. Plugin POSTs `/v1/swap/initiate` to the referee with the assembled
   payload.
8. Plugin polls `/v1/swap/{id}/poll` for status; UI updates phase by phase.

### 8.3 Push delivery on success (Bob)

1. Push provider delivers `release-settle` to Bob's PGP fp.
2. extro-node routes to the plugin's `release_settle.js` handler.
3. Handler decrypts Alice's encrypted partial-sig via `pgp.decrypt`.
4. Handler asks `ark.musig2.aggregate_and_broadcast` — extro-node
   prompts user "broadcast TX_settle on ARK?".
5. On user OK, ARK broadcast happens; vtxo claimed.
6. Handler signs ack-receipt via `pgp.sign`, POSTs to
   `/v1/swap/{id}/ack`.
7. UI updates to "Settled — your ARK is in the wallet".

### 8.4 Push delivery on abort (Bob)

1. Push provider delivers `invalidate` to Bob's PGP fp.
2. Handler runs `webcash.read` to confirm the hash is one of ours.
3. Handler asks `bip32.derive` for a fresh secret.
4. Handler asks `webcash.replace([old], [new])` — user confirms.
5. Webcash secret is invalidated; UI shows "Refund coming — your
   webcash is safe".

### 8.5 Uninstall

1. User opens extro-node's plugin manager, clicks uninstall on
   webycash-referee-client.
2. extro-node revokes all grants.
3. Drops plugin-scoped storage (any unfinished swaps' state — user is
   warned of in-flight risk).
4. Unregisters push handlers.
5. Closes any plugin iframes.

## 9. Open questions for extro-node maintainers

- **Manifest distribution** — pinned URL list vs decentralised
  catalogue (Nostr / IPFS / extronet)?
- **Capability versioning** — when a capability's semantics change,
  how do existing grants migrate?
- **Plugin signing** — single-author PGP vs DAO multisig vs Ledger of
  Audited Plugins?
- **Sandboxing strength** — iframe + postMessage is good for desktop
  browsers; mobile / native PWAs may need more.
- **Cross-plugin communication** — should two plugins (e.g. this one
  and a future bookkeeping plugin) be able to share data, mediated by
  extro-node?
- **Background work budgets** — how aggressively to throttle
  background pollers?
- **Dispute resolution** — what happens if a plugin author goes rogue
  (publishes a malicious update)? Forced revocation registry?

These are out of scope for `webycash-referee-client` to answer —
flagging them for the extro-node design team.

## 10. References

- [`docs/spec.md`](spec.md) — what `webycash-referee-client` specifically does
- [`docs/ui-flow.md`](ui-flow.md) — user-facing flows
- [`webycash-server/docs/referee-zkp-based-swap.md`](../../webycash-server/docs/referee-zkp-based-swap.md) — protocol spec
- [`webycash-server/referee/docs/hook-contract.md`](../../webycash-server/referee/docs/hook-contract.md) — wallet-side contract
- [`webycash-server/referee/docs/musig2-ceremony.md`](../../webycash-server/referee/docs/musig2-ceremony.md) — MuSig2 protocol
- [`webycash-server/referee/docs/zkp-circuits.md`](../../webycash-server/referee/docs/zkp-circuits.md) — Groth16 circuit specs
