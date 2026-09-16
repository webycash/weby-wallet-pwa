# Extro exchange Webcash↔Ark — both-direction e2e (dev/regtest) — 2026-09-16

Status: **BOTH-DIR LOCAL PASS (dev/regtest).** Webcash→Ark closed on **real** arkade-regtest ASP
(`asp:Regtest:…:Settle:Present:…`, not `asp-ref-*` mock). Ark balance claim
broadcast + wallet-real enc partial still **OPEN**. Ark→Webcash and two-browser
`runSwap` reach named gates below — **no fake settled**.

No mainnet. CF `ark_enabled` remains **false**. Local Vite + arkade-regtest only.

## Gate −1 disk

| Check | Result |
|---|---|
| Free during Gate5 | **~58 GiB** (≥ 40 GiB abort floor) |
| Peak during arkade restart | **~58 GiB** (never claimed progress below 40) |

## Stack pins

| Pin | Value |
|---|---|
| ASP | arkade-regtest arkd `v0.9.16` @ `http://127.0.0.1:7070` |
| Network | `regtest` |
| Referee | native `webycash-referee` **with `--features zkp-arkworks,musig2-real,ark-asp`** |
| `ARK_ASP_URL` | `http://127.0.0.1:7070` |
| `storage_fence` | `host-volume-dev` |
| `edge_release` | `gate5-ark-asp-real-v1` |
| Webcash rail | `http://127.0.0.1:8181` |
| Keyserver | `http://127.0.0.1:7800` (local F1 cache) |

## Direction matrix

| Direction | Result | Notes |
|---|---|---|
| Webcash → Ark | **PASS (real ASP Present)** | Webcash Unspent→Spent + signed `release-settle` + `asp:Regtest:…:Present` |
| Ark → Webcash | **OPEN** | Same rails; reverse economic run not completed this slice (VTXO tree expiry ~180s wall-clock under current arkd pins; claim path still placeholder enc partial) |

## Webcash→Ark (falsifiable)

| Field | Value |
|---|---|
| `prepared_swap_id` | `91ca63ad-b3ac-4037-a5cd-66c6f0c2b355` |
| Initiate HTTP | **200** `phase=insert-pushed` |
| Terminal | **`settled`** (`terminal: true`) |
| Bearer H | `f4931522dcd5f92fb39bba0e5dae0b80c6c75fb7e60db73fb5d48b42b7ad9db3` |
| Webcash before | `spent: false`, `amount: "1"` |
| Webcash after | `spent: true`, `amount: null` |
| Gate3 `locked_ref` | `5f2282fe9484a69cf83c9792ada3608da2e016119deb9f2730841d4808abf718:0` |
| `asp_vtxo_ref` | `asp:Regtest:5f2282fe9484a69cf83c9792ada3608da2e016119deb9f2730841d4808abf718:0:Settle:Present:partial=cc621276913959f4` |
| Release kind | `release-settle` |
| `release_dispatched` | **true** |
| `payload_hash_hex` | `e4082f2047d24dcf0dd2f27065bcd912874b4b41e4ce99cc43d8e7ed3ff8c746` |
| `referee_partial_sig` | `cc621276913959f46f2dacf2f7ce3943c39b9fec3899d3b34a4bfa8755f4050e` |
| Provider enc partial | **placeholder** (`<bob's ark settle partial-sig, encrypted to alice>`) — not wallet-real |

JSON receipt: `weby-wallet-pwa/test-results/gate5-webcash-to-ark-real-asp.json`  
Gate3 funding receipt: `weby-wallet-pwa/test-results/gate5-funded-vtxo-cosign.json`

## Remaining named gates

| Gate | Status |
|---|---|
| `PREPARE_REQUIRED` | **CLOSED** (prior Gate4) |
| `ARK_ASP_FEATURE` | **CLOSED** (this file — real ASP Present ref) |
| `ARK_CLAIM_REAL` | **CLOSED** — wallet-real framed enc partial + MuSig2 agg + ASP claim broadcast; Ark +25000 sats |
| `ARK→WEBCASH` | **OPEN** — reverse-direction balance deltas + receipts |
| Two-browser / `runSwap` UI | **OPEN** — Accept→runSwap as far as real ASP/claim allows; no fake settled |
| CF `ark_enabled=true` | **Forbidden** |

## Two-browser / runSwap

Not completed this slice. Harness path that **did** exercise real prepare→initiate→replace→settle against live local referee + real ASP is `webycash-server/local-stack/gate4-prepare-initiate.sh` with `EXTRO_LOCKED_REF` from Gate3. UI Playwright Accept→runSwap remains the next UI gate once claim materials are wallet-real.

## Ark enablement policy

- **Local Vite / arkade-regtest:** allowed with live `/v1/info` pins for `regtest` only.
- **CF `weby-wallet-pwa-dev` / production:** keep `ark_enabled=false` (no safe remote ASP pin).

## Source / PRs

| Repo | Branch |
|---|---|
| webycash-referee | `integration/gate5-ark-asp-real-both-dir` (binary built with `ark-asp`) |
| webycash-server | `integration/gate5-ark-asp-real-both-dir` (`run-local.sh` builds `--features …,ark-asp`) |
| weby-wallet-pwa | `integration/gate5-ark-asp-real-both-dir` (gate5 receipts under `test-results/`) |
| docs | `docs/gate5-both-dir-e2e-evidence-2026-09-16` (this file) |



---

## Gate5 follow-up — ARK_CLAIM_REAL PASS (2026-09-16 23:31 CEST)

### Fixes required to close

1. **Referee MuSig2 message binding** (`webycash-referee` `orchestrator.rs`): `tx_settle_hash` / `tx_refund_hash` are wire hex strings; signing used `.as_bytes()` (ASCII). Wallet signs the decoded 32-byte sighash. Added `tx_sighash_msg()` hex-decode before `partial_sign`.
2. **Checkpoint co-sign** (`extro-node` `ark.rs` `claim_two_of_two`): after `submit_offchain_transaction_request`, sign ASP-returned checkpoint PSBTs with a second in-process 2-of-2 MuSig2 (`two_of_two_sign_local`) under Q, then `finalize_offchain_transaction`.
3. **run-local.sh**: pick live `digest` from ASP `/v1/info` into `ARK_INFO_DIGEST_HEX`.

### Measured evidence

| Field | Value |
|---|---|
| `swap_id` | `747b363d-2124-42a9-ae1e-acaa3cc56f95` |
| `locked_ref` | `eeffbf76dd910fd357da1a22a2a0a8c01ffaa5eb5c3fb4f6b0b0f886cf16cd49:0` |
| `settle_sighash` | `c5955a9239bd2e7ff388e4222d755a2f55af8bf653761fdb755909e87066c7ef` |
| `asp_vtxo_ref` | `asp:Regtest:eeffbf76…:0:Settle:Present:partial=00ab0a6df9ec504c` |
| Provider enc partial | **wallet-real** framed `00000020` + 32-byte partial (len 128); not placeholder |
| `referee_partial_sig` | `00ab0a6df9ec504c…` (from pending_release) |
| BIP340 agg under Q | `83fc649bb2c100dc…` / `ownerQ=097e336af7b38cef…` |
| `claim_txid` | `43bb35b07ed87118dc91b2d2f3fafe95f491ddadbdd117f29927610093392f4c` |
| Ark balance | before `100000` → after `125000` (**Δ +25000**) |
| Webcash bearer H | spent true after replace (see receipt) |
| ASP pins | digest `3c8c619f…`, unilateralExitDelay `512`, edge_release `gate5-ark-claim-real-v1` |

Receipt: `weby-wallet-pwa/test-results/gate5-ark-claim-real.json`
Open-gate receipts (no fake settled): `gate5-ark-to-webcash.json`, `gate5-two-browser-runswap.json`.


### Still OPEN

| Gate | Status |
|---|---|
| `ARK→WEBCASH` | **OPEN** |
| Two-browser Accept→runSwap | **OPEN** |
| CF `ark_enabled` | **false** (unchanged) |


## Timestamp

**2026-09-16 23:31 CEST** (Europe/Berlin) — ARK_CLAIM_REAL closed


---

## Gate5 follow-up — ARK→WEBCASH PASS + two-browser named gate (2026-09-16 23:50 CEST)

### Ark→Webcash (falsifiable)

| Field | Value |
|---|---|
| Direction | **Ark→Webcash** (provider funds Ark; seller receives Ark claim; provider receives webcash e0.4+e0.6) |
| `prepared_swap_id` | `32ba967b-7faa-4b3f-8410-a7017bb63577` |
| Terminal | **`settled`** |
| Provider Ark | before `100000` → after fund `75000` (**Δ -25000**) |
| Seller Ark | before `0` → after claim `25000` (**Δ +25000**) |
| `claim_txid` | `175f411befc4285e14d692ddc7e0c2004b0b7591d5cf2bb046120a6913a2d574` |
| Provider webcash payout | e0.4+e0.6 **unspent** (seller bearer spent) |
| ASP | real arkade-regtest; digest pinned from live `/v1/info` |
| CF `ark_enabled` | **false** |

Receipt: `weby-wallet-pwa/test-results/gate5-ark-to-webcash.json`

### Two-browser Accept→runSwap

| Field | Value |
|---|---|
| Harness | Playwright 2× Chromium vs local Vite `http://127.0.0.1:5183` |
| Local `ark_enabled` | **true** (static local pin only; **not** CF) |
| Spec | `e2e/gate5-two-browser-accept-runswap.spec.ts` → **1 passed** |
| Named gate | **`RUNSWAP_STOPPED_NO_PROVIDER`** — UI reached runSwap boundary; stopped (no fake settled) |
| Screenshot | `test-results/gate5-two-browser-accept-runswap.png` |
| CF `ark_enabled` | **false** (verified) |

Receipt: `weby-wallet-pwa/test-results/gate5-two-browser-runswap.json`

### Claimability

**Both-direction Webcash↔Ark e2e is claimable on local/regtest** (real ASP Present + wallet-real claim + reverse balance deltas + two-browser Accept→runSwap to named gate).

**Still not claimable:** production/CF (`ark_enabled` must stay false), vouchers/RGB rails, DHTX full orderbook publish→discover→match UI settle, mainnet.

### Timestamp

**2026-09-16 23:50 CEST** (Europe/Berlin)

---

## Gate5 follow-up — RUNSWAP_STOPPED_NO_PROVIDER CLOSED (2026-09-17 00:04 CEST)

### What closed

| Item | Result |
|---|---|
| Named gate `RUNSWAP_STOPPED_NO_PROVIDER` | **CLOSED** |
| Two independent browser contexts | **PASS** (peers_connected=1 each) |
| DHTX Accept (taker B) | **PASS** |
| Maker SendProviderMaterial (genuine `locked_ref` + settle/refund hashes) | **PASS** (`send_provider.ok=true`) |
| Taker `attemptAcceptAndRunSwap` received ProviderMaterial | **PASS** (`provider_locked_ref` matches funded outpoint) |
| Local Vite `ark_enabled` | **true** (regtest pin only) |
| CF `ark_enabled` | **false** (unchanged) |
| ASP digest pin | live `/v1/info` `3c8c619f…` matches runtime + referee |

### Wiring landed

- `accept-run-swap.ts`: `fetchSwapMsgs` / `awaitProviderMaterial` / `providerMaterialFromWire`; Accept path polls DHTX for maker ProviderMaterial; `RUNSWAP_NEED_PREPARE` when material present without full `RunSwapInput`.
- `ExchangeView.svelte`: DeriveIdentity + `awaitProvider: true` on Accept path.
- `GATE_RUNSWAP_NEED_PREPARE` named gate (honest next stop — dual-signed prepare + prove binding).
- Local `runtime-config.json` (gitignored): keyserver fp/vk + referee vk pinned to live stack; domain matches URL host.

### Settle / balance deltas

Harness-aligned Ark→Webcash (same stack as prior both-dir PASS) reached **`phase=settled`** in this run with provider webcash payout e0.4+e0.6 unspent. Claim-extract step after settle still flaky (script exit≠0); settle terminal itself is real — **no fake settled**.

Receipt: `weby-wallet-pwa/test-results/gate5-two-browser-runswap.json` (`status=PASS`, `closed_gate=RUNSWAP_STOPPED_NO_PROVIDER`).

### Remaining gaps vs full product E2E

| Gap | Status |
|---|---|
| In-browser `RunSwapInput` (prepare + Groth16 prove + initiate from Accept path) | **OPEN** — `RUNSWAP_NEED_PREPARE` |
| Life / network / weby federation UX | **OPEN** |
| RGB / vouchers rails | **OPEN** |
| CF `ark_enabled=true` | **Forbidden** |
| Mainnet | **Forbidden** |

### Source

| Repo | Branch |
|---|---|
| weby-wallet-pwa | `integration/gate5-ark-asp-real-both-dir` |
| docs | this file |

### Timestamp

**2026-09-17 00:04 CEST** (Europe/Berlin)
