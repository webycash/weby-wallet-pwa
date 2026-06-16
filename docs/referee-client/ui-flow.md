# webycash-referee-client — UI flows

User-facing screens of the plugin. Implementation lands when extro-node's
plugin runner ships; this document specifies the intent.

## Screen map

```
┌──────────────────────────────────────────────────────────────┐
│ extro-node tray:                                              │
│   ┌───────────────────────────────────────────────┐           │
│   │ ⚡ Swap webcash ↔ Bitcoin ARK                  │           │
│   └───────────────┬───────────────────────────────┘           │
│                   │                                            │
│                   ▼                                            │
│           ┌───────────────────┐                                │
│           │ 1. Pick role      │   "Sell webcash" / "Sell ARK"  │
│           └───────────┬───────┘                                │
│                       ▼                                        │
│           ┌───────────────────┐                                │
│           │ 2. Counterparty   │   pick from extronet           │
│           │    selection      │   OR paste PGP pubkey          │
│           └───────────┬───────┘                                │
│                       ▼                                        │
│           ┌───────────────────┐                                │
│           │ 3. Confirm        │   amounts, vtxo, fee           │
│           │    parameters     │   show pinned referee pubkey   │
│           └───────────┬───────┘                                │
│                       ▼                                        │
│           ┌───────────────────┐                                │
│           │ 4. Build proofs   │   "Generating ZKP… 12s"        │
│           │    + payloads     │   (WASM Groth16 prover)        │
│           └───────────┬───────┘                                │
│                       ▼                                        │
│           ┌───────────────────┐                                │
│           │ 5. Submit to      │   POST /v1/swap/initiate       │
│           │    referee        │   show progress per phase      │
│           └───────────┬───────┘                                │
│                       ▼                                        │
│           ┌───────────────────┐                                │
│           │ 6. Phase progress │   init → zkps → pre-checked →  │
│           │                   │   insert-pushed → settled OR   │
│           │                   │   aborted → invalidated →      │
│           │                   │   refunded                     │
│           └───────────┬───────┘                                │
│                       ▼                                        │
│           ┌───────────────────┐                                │
│           │ 7. Outcome screen │   Settled (success) OR         │
│           │                   │   Refunded (abort) — explainer │
│           └───────────────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

## 1. Pick role

Two large buttons:

- **"I have webcash, want ARK"** → Bob role
- **"I have ARK, want webcash"** → Alice role

Plus links:

- "What is a webycash referee swap?" → explainer overlay quoting
  `referee-zkp-based-swap.md` §0.
- "How safe is this?" → trust-model summary linking to
  `referee/docs/trust-model.md`.

## 2. Counterparty selection

Two paths:

### 2A. Extronet browse

Plugin asks extro-node `extronet.read` capability for matching offers:

- Bob role: list offers tagged "selling ARK for webcash".
- Alice role: list offers tagged "selling webcash for ARK".

Each row shows: counterparty PGP fingerprint (truncated + verified
badge if pinned), offered amount, ask amount, expiration, signed offer
proof.

User clicks one → proceeds with that counterparty.

### 2B. Direct paste

Text field for the counterparty's full PGP pubkey. Plugin verifies
self-signature, displays the fingerprint + UID for confirmation.

## 3. Confirm parameters

Read-only form showing:

- **Your role**: Bob / Alice
- **Your contribution**: e.g. "100 webcash from secret #ab12…"  (Bob)
  or "0.001 BTC from vtxo abc…"  (Alice)
- **Counterparty contribution**: matching opposite leg.
- **Referee**: pinned Ed25519 pubkey + MuSig2 pubshare. First-time
  pinning: prompt user to confirm. Subsequent: read-only.
- **Estimated time**: "~30 seconds for ZKP proving + ~1 minute for
  swap execution + final ARK confirmation".

Buttons: **[Generate proofs and submit]** / **[Cancel]**.

## 4. Build proofs + payloads

Loading screen with breakdown of what's happening:

- "Generating Groth16 proof for payload honesty…" (~10–30 s for Bob)
- "Generating Groth16 proof for signature honesty…" (~30–60 s for Alice)
- "Encrypting payload with counterparty's PGP pubkey…"
- "Producing MuSig2 nonce commitments via extro-node…"

Each step that consults extro-node may surface a consent prompt (per
`extro-node-plugin-system.md §4.4`). The UI passes through to
extro-node's modal; on resume, the plugin continues.

## 5. Submit to referee

POST `/v1/swap/initiate` happens. Loading spinner with subtext:

- "Submitting to referee…"
- "Verifying ZKPs…"

The referee's response is synchronous; on success it hands back the
swap_id + outcome. The plugin starts polling
`/v1/swap/{id}/poll` immediately for backup, but the primary signal is
push-driven.

## 6. Phase progress

Live phase tracker. Each phase is a row that lights up as the swap
progresses:

```
✓ init                    — swap registered (1s)
✓ zkps-verified           — referee accepted both proofs (4s)
✓ pre-checked             — webcash leg confirmed unspent on webcash.org (2s)
⟳ insert-pushed           — waiting for Alice's wallet to take ownership… (attempt 1/3)
○ settled                 — pending
○ aborted                 — pending
○ invalidated             — pending
○ refunded                — pending
```

The currently-active phase has an animated indicator. The "View audit
log" button at the top opens the signed audit log via `/v1/swap/{id}/audit`.

The plugin polls `/v1/swap/{id}/poll` every 3s as a fallback in case
push delivery is delayed.

## 7. Outcome screens

### 7A. Settled (Bob)

```
┌─────────────────────────────────────────┐
│  ✓ Settled                              │
│                                         │
│  Your ARK vtxo is now in your wallet.   │
│  Outpoint: <abc…123>                    │
│  Amount:   0.001 BTC                    │
│                                         │
│  Webcash you sold: 100 (now spent)      │
│  ARK you received: 0.001 BTC            │
│                                         │
│  ┌──────────────┐  ┌──────────────┐     │
│  │ View audit   │  │ Done         │     │
│  │ log          │  │              │     │
│  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────┘
```

### 7B. Settled (Alice)

```
┌─────────────────────────────────────────┐
│  ✓ Settled                              │
│                                         │
│  100 webcash is now in your wallet.     │
│  Stored under hash <h…>                 │
│                                         │
│  ARK you spent: 0.001 BTC               │
│  Webcash you received: 100              │
│                                         │
│  ┌──────────────┐  ┌──────────────┐     │
│  │ View audit   │  │ Done         │     │
│  │ log          │  │              │     │
│  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────┘
```

### 7C. Refunded (Alice)

```
┌─────────────────────────────────────────┐
│  ↩ Refunded                             │
│                                         │
│  Your ARK vtxo was returned to you.     │
│  Outpoint: <abc…123>                    │
│                                         │
│  Why this happened:                     │
│   The other party's wallet didn't       │
│   complete the webcash transfer in      │
│   time. The referee invalidated the     │
│   stuck secret on the other side and    │
│   released your refund signature.       │
│                                         │
│  ┌──────────────┐  ┌──────────────┐     │
│  │ View audit   │  │ Done         │     │
│  │ log          │  │              │     │
│  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────┘
```

### 7D. Refunded (Bob — abort with invalidation)

```
┌─────────────────────────────────────────┐
│  ↩ Refunded                             │
│                                         │
│  The swap was aborted. Your webcash is  │
│  safe — you now hold 100 webcash under  │
│  a fresh secret (your old secret was    │
│  rotated as a precaution).              │
│                                         │
│  Why this happened:                     │
│   The other party's wallet didn't       │
│   complete the swap in time. The        │
│   referee asked us to rotate the secret │
│   so any leaked cleartext is now        │
│   worthless.                            │
│                                         │
│  ┌──────────────┐  ┌──────────────┐     │
│  │ View audit   │  │ Done         │     │
│  │ log          │  │              │     │
│  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────┘
```

## 8. History view

Reachable from the plugin's main entry. Lists every past swap with:

- Date + counterparty + role + amounts
- Final outcome (Settled / Refunded)
- Link to the audit log
- "Repeat with same counterparty" shortcut

History is read from plugin-scoped storage; no network call required.

## 9. Recovery

If the user closes the plugin mid-swap:

- Plugin-scoped storage retains the swap state.
- Push handlers (registered as service-worker callbacks) continue to
  receive deliveries even with the iframe closed.
- Next time the user opens the plugin, a banner shows "1 swap in
  progress (#a1b2c3…)" with options:
  - **Resume tracking** — re-open the phase progress screen.
  - **Force-poll** — `/v1/swap/{id}/poll` to refresh state immediately.
  - **Abort manually** — out-of-protocol; only available after the
    HTLC timeout window has elapsed.

## 10. Error states

| Condition | UI |
|---|---|
| Referee unreachable | Banner: "Referee offline. Push delivery may be delayed." Continue polling; let user trigger manual retry. |
| Capability denied by user | Modal: "Swap can't continue — extro-node denied <capability>". Offer a "retry" or "cancel swap" button. |
| ZKP proving failed | Modal: "Couldn't generate zero-knowledge proof. This typically means low memory. Close other tabs and retry." |
| Push provider not registered | Modal: "extro-node hasn't registered with a push provider. Open extro-node settings to configure." |
| Counterparty rejects ZKP | Outcome screen: "Counterparty's wallet rejected the swap parameters. No funds moved." Detailed cause from referee response body. |
| Pre-check shows already spent | Outcome screen: "Your webcash hash was already spent before the swap could begin. No funds moved." (This means a stale wallet state — user should refresh.) |

## 11. Accessibility

- All buttons keyboard-reachable; focus rings visible.
- Phase progress announces phase transitions to screen readers via
  `aria-live="polite"`.
- High-contrast theme via extro-node's theming variables.
- Operational text (e.g. "your ARK vtxo is now in your wallet") avoids
  jargon; technical breakdowns are behind disclosure widgets.

## 12. Internationalisation

- All strings live in a single locale file per language under
  `/plugin/locales/`.
- Default locale: `en`.
- Fingerprints, hashes, signatures rendered in monospace and never
  translated.
- Phase names rendered as both technical (`insert-pushed`) and
  human-friendly ("Waiting for counterparty's wallet").
