# Weby Wallet PWA

<p align="center">
<em>Private webcash wallet that runs entirely in your browser. No server-side logic, no proxies, no tracking. Your keys never leave your device.</em>
</p>

<p align="center">
<a href="https://github.com/webycash/weby-wallet-pwa/actions/workflows/ci.yml"><img src="https://github.com/webycash/weby-wallet-pwa/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

**Live app:** [https://webycash.github.io/weby-wallet-pwa/wallet](https://webycash.github.io/weby-wallet-pwa/wallet)

---

## What is Webcash?

Webcash is a centralized bearer e-cash system where value exists as cryptographic strings spent exactly once. A central server validates all transactions and prevents double-spending. See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the full specification.

## Features

- **Master Wallet** — BIP39 mnemonic → BIP32 hardened slot derivation for webcash, bitcoin, RGB, vault, and PGP keys
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

All cryptographic operations (wallet state, mining, server communication) are delegated to Rust compiled to WASM via `harmoniis-wallet`. The TypeScript layer handles UI, persistence, and user interaction only.

## WASM Engine

The wallet engine is powered by [`harmoniis-wallet`](https://github.com/harmoniis/harmoniis-wallet) compiled to WebAssembly. This provides:

- **Master keychain**: BIP39 mnemonic → BIP32 hardened slot derivation (webcash, bitcoin, RGB, vault, PGP families)
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

Deployed automatically to GitHub Pages on every push to `main`. CI builds the WASM module, runs svelte-check, and produces a static site.

```bash
npm run build   # produces static site in build/
```

The Cloudflare Worker (`worker/`) generates OpenGraph images for shared payment links.

## Roadmap

### v0.2.0 — Polish (in progress)
- [x] QR code scanning for webcash insert
- [ ] Transaction history with timestamps
- [ ] Multi-wallet UI (switch between labeled wallets)
- [ ] Proper PNG icons (192, 512, maskable)

### v0.3.0 — Bitcoin Integration
- [ ] Bitcoin ARK protocol (off-chain VTXOs via Arkade ASP)
- [ ] On-chain Bitcoin receive/send (BIP86 Taproot)
- [ ] RGB smart contracts (client-side validated state)
- [ ] Unified balance view across payment rails

### v0.4.0 — Advanced
- [ ] Multi-device sync via encrypted backup
- [ ] Payment request deep links
- [ ] Push notifications for mining results
- [ ] RGB asset issuance and transfer UI

## Tech Stack

- **Framework**: SvelteKit 2 + Svelte 5
- **Styling**: Tailwind CSS 3 + shadcn-svelte
- **WASM**: harmoniis-wallet (Rust → wasm32)
- **GPU**: wgpu via WebGPU
- **Build**: Vite 7 + vite-plugin-wasm

## License

MIT
