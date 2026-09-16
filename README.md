# Weby Wallet PWA

<p align="center">
<em>Browser-held Webcash identity/wallet and value-free Extro exchange client. Private keys stay on the device; configured rails, keyserver and referee remain external trust boundaries.</em>
</p>

<p align="center">
<a href="https://github.com/webycash/weby-wallet-pwa/actions/workflows/ci.yml"><img src="https://github.com/webycash/weby-wallet-pwa/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

**Verified development candidate:** [https://dev.weby.cash/wallet/](https://dev.weby.cash/wallet/)

**Public production URL:** [https://weby.cash/wallet/](https://weby.cash/wallet/)
is an older, unpromoted deployment and must not be treated as the verified Ark
candidate.

Release status: the development wallet can form a real Extro DataChannel,
propagate a signed `BitcoinArk/Webcash` order and exchange an authenticated
acceptance. `ark_enabled=false`; genuine ProviderMaterial, Ark funding,
settlement and recovery remain production blockers. No mainnet value is
authorized.

---

## What is Webcash?

Webcash is a centralized bearer e-cash system where value exists as cryptographic strings spent exactly once. A central server validates all transactions and prevents double-spending. See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the full specification.

## Features

- **Master Wallet** — BIP39 mnemonic → BIP32 hardened slot derivation for webcash, bitcoin, RGB, vouchers, and PGP keys
- **Webcash Wallet** — Each webcash slot has its own 4-chain SHA256 derivation (Receive, Pay, Change, Mining)
- **Multi-wallet** — Multiple labeled sub-wallets per family (main, savings, cloudminer), each a separate BIP32 slot
- **GPU Mining** — WebGPU-accelerated proof-of-work mining directly in the browser
- **Encryption** — Password (PBKDF2 + AES-256-GCM) or WebAuthn passkey (biometric)
- **Backup/Restore** — Full master backup, per-wallet JSON snapshots, mnemonic recovery
- **Share Payments** — Generate payment webcash strings + QR codes for recipients
- **Roaming Wallets** — Import external wallet files (`.webcash` format, encrypted or plaintext)
- **PWA** — Installable, offline balance viewing, service worker caching
- **Privacy** — All data in IndexedDB, encrypted at rest, zero telemetry

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a browser with WebGPU support (Chrome 113+, Edge 113+).

## Architecture

```
src/
├── lib/core/           Pure functional domain logic (no side effects)
│   ├── types.ts        Algebraic types matching Rust structs
│   ├── wasm.ts         WASM module loader (harmoniis-wallet)
│   ├── encryption.ts   WebAuthn passkey + password encryption
│   ├── persistence.ts  IndexedDB + localStorage adapter
│   ├── webcasa.ts      .webcash file format parser
│   └── miner.ts        Mining coordination (delegates to WASM)
├── lib/stores/         Reactive state (Svelte 5 runes)
│   ├── wallet.svelte.ts   Main wallet operations (WASM bridge)
│   ├── settings.svelte.ts License, encryption, backup state
│   └── network.svelte.ts  Production/testnet toggle
├── lib/components/     Declarative UI (shadcn-svelte + Tailwind)
│   ├── wallet/         Feature components (Dashboard, Miner, Pay, etc.)
│   └── ui/             Base component library
├── lib/workers/        Web Worker for legacy CPU mining
├── routes/             SvelteKit pages
└── service-worker.ts   Offline precaching strategy
```

Wallet/mining operations use Rust compiled to WASM via `harmoniis-wallet`. The
Extro identity, keyserver bootstrap, WebRTC/DHTX order plane and prepare
protocol use the separately pinned `extro-node` WASM package. The TypeScript
layer owns UI, persistence, strict runtime configuration and orchestration.

## WASM Engine

The wallet engine is powered by [`harmoniis-wallet`](https://github.com/harmoniis/harmoniis-wallet) compiled to WebAssembly. This provides:

- **Master keychain**: BIP39 mnemonic → BIP32 hardened slot derivation (webcash, bitcoin, RGB, vouchers, PGP families)
- **Webcash operations**: insert, pay, check, merge, recover (via [`webylib`](https://github.com/webycash/webylib))
- **GPU mining**: wgpu SHA256 proof-of-work on WebGPU backend
- **State management**: in-memory HarmoniiStore, serializable to JSON for IndexedDB persistence

The WASM module is loaded on first interaction and cached by the service worker.

## Documentation

| Document | Description |
|----------|-------------|
| [Protocol](docs/PROTOCOL.md) | Webcash protocol specification |
| [Key Model](docs/KEY_MODEL.md) | Master wallet, slot families, webcash 4-chain derivation |
| [Mining](docs/MINING.md) | GPU/CPU mining implementation |
| [Security](docs/SECURITY.md) | Encryption, recovery, threat model |
| [Payments](docs/PAYMENTS.md) | Share payments and roaming wallets |

## Encryption

| Method | Algorithm | When prompted |
|--------|-----------|---------------|
| Password | PBKDF2 (100k iterations) + AES-256-GCM | Every wallet open |
| Passkey | WebAuthn PRF + AES-256-GCM | Biometric each visit |

The wallet snapshot (JSON export of all state) is encrypted before storing in localStorage. Raw IndexedDB stores are used for operational state. CLI equivalent: `webyc encrypt` / `webyc decrypt`.

## Deployment

Development is an explicit Cloudflare Worker/static-assets release. It is not a
GitHub Pages promotion. Build once, copy that exact directory to the Worker
asset root, record the previous version, deploy, and test the same bytes:

```sh
npm ci
npm run verify:wasm
npm test -- --run
npm run check
npm audit
BASE_PATH=/wallet npm run build
npm run scan:release

rsync -a --delete build/ dev-deploy/wallet/
diff -qr build dev-deploy/wallet
npx wrangler deployments list --config wrangler.dev.toml
npx wrangler deploy --config wrangler.dev.toml \
  --message "SOURCE_COMMIT; Ark disabled; rollback PREVIOUS_VERSION"

E2E_BASE_URL=https://dev.weby.cash/wallet \
  npx playwright test e2e/gate1-live.spec.ts \
  --repeat-each=10 --workers=1 --reporter=line
```

The live `/wallet/runtime-config.json` and `index.html` must match the candidate
manifest. Development must retain `PUBLIC_ARK_ENABLED="false"` until the
runbook's deterministic settle/refund, disposable regtest, signet balance,
restart/replay, referee durability and cryptographic ceremony gates all pass.

Production requires a separate Wrangler configuration, database/state names,
operator/referee/keyserver pins, TURN credentials and non-development ZKP
artifacts. The production boot validator rejects development, signet, empty Ark
pins, public relay defaults and the development ceremony. Promote an already
tested immutable version; do not rebuild for production.

Rollback immediately on a trust-pin mismatch, mock/placeholder detection,
failed DataChannel reconnect, unexpected chain, balance disagreement, missing
refund or unexplained 5xx. Record both the candidate and last-known-good Worker
version before deployment; never guess a rollback target.

## Roadmap

### v0.2.0 — Polish (complete)
- [x] QR code scanning for webcash insert
- [x] Multi-wallet UI (switch between labeled wallets)
- [x] Proper PNG icons (192, 512, maskable)

### v0.3.0 — Bitcoin, RGB, and Vouchers
- [ ] Transaction history with timestamps
- [ ] Bitcoin Ark protocol: signed V2 prepare, request-unique contract funding,
  and exact VTXO recheck are implemented; deterministic settle/refund signing
  and two-wallet signet evidence still block release
- [ ] On-chain Bitcoin receive/send (BIP86 Taproot)
- [ ] RGB smart contracts (client-side validated, multiple witness backends)
- [ ] Voucher wallet (bearer credits via `webycash-voucher-server`)
- [ ] Unified balance view across payment rails

### v0.4.0 — Advanced
- [ ] P2P exchange with RGB contracts and zero-knowledge proofs (ZKP)
- [ ] RGB asset portfolio dashboard
- [ ] Hardware wallet integration (WebUSB/WebHID)

## Tech Stack

- **Framework**: SvelteKit 2 + Svelte 5
- **Styling**: Tailwind CSS 3 + shadcn-svelte
- **WASM**: harmoniis-wallet (Rust → wasm32)
- **GPU**: wgpu via WebGPU
- **Build**: Vite 7 + vite-plugin-wasm

## License

MIT
