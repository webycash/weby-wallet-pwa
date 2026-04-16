# Weby Wallet PWA

Private webcash wallet that runs entirely in your browser. No server-side logic, no proxies, no tracking. Your keys never leave your device.

## Architecture

```
core/           Pure functional domain logic (no UI, no side effects)
  types.ts      Algebraic types matching webylib Rust structs
  wallet.ts     Wallet operations (insert, pay, check, merge, recover, mine)
  storage.ts    IndexedDB adapter (effect boundary)
  server.ts     Fetch adapter — calls webcash protocol endpoints directly
  encryption.ts WebAuthn passkey + password encryption (Argon2 + AES-256-GCM)
  wasm.ts       WASM module loader (@webycash/webylib-wasm)

stores/         Reactive state (thin Svelte wrappers over core/)
components/     Declarative UI (shadcn-svelte + Tailwind)
workers/        Web Worker for testnet CPU mining
```

## Quick Start

```bash
npm install
npm run dev
```

## Features

- **Wallet operations**: create, insert, pay, check, merge, recover
- **Testnet mining**: CPU miner in Web Worker
- **Encryption**: password (Argon2 + AES-256-GCM) or WebAuthn passkey
- **Backup/restore**: JSON snapshot export/import, master secret recovery
- **PWA**: installable, offline balance viewing, service worker
- **Privacy**: all data in IndexedDB, encrypted at rest, no telemetry

## Encryption

| Method | Algorithm | When prompted |
|--------|-----------|---------------|
| Password | Argon2id + AES-256-GCM | Every wallet open |
| Passkey | WebAuthn PRF + AES-256-GCM | Biometric each visit |

CLI equivalents: `webyc encrypt` / `webyc decrypt` (password or OS keychain).

## Deployment

Deployed to GitHub Pages on release. CI checks on every push.

```bash
npm run build   # produces static site in build/
```

## License

MIT
