# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-21

### Added
- **WebGPU mining**: GPU-accelerated proof-of-work via harmoniis-wallet WASM (wgpu)
- **Multi-wallet UI**: Wallet selector, labeled wallets, tab switching
- **Roaming wallets**: Import external `.webcash` files (encrypted or plaintext)
- **Full backup**: Export/import complete wallet state including master key
- **QR scanner**: Camera-based QR scanning for webcash insert
- **Share payments**: WhatsApp, email, native share, deep links with OG previews
- **Receive gift flow**: Auto-create wallet + insert from payment deep link
- **Service worker**: Full offline support with cache-first strategy
- **Version display**: App version shown in footer on all screens
- **Release workflow**: GitHub Releases created on tag push

### Changed
- **WASM engine**: Migrated from pure TypeScript to harmoniis-wallet WASM (all crypto in Rust)
- **Server communication**: All HTTP calls happen inside WASM, zero fetch from TypeScript
- **Mining**: GPU default with CPU fallback, cached mining target (30s TTL)
- **harmoniis-wallet**: Bumped through v0.1.70 to v0.1.113 (50+ fixes)
- **webylib**: Bumped through v0.3.1 to v0.3.10 (WASM support, IndexedDB, recovery fixes)
- **CI**: Node 24, Rust WASM build, wasm-opt optimization, Cloudflare Worker deploy
- **Documentation**: Comprehensive README, protocol/wallet/mining/security/payments docs
- **Roadmap**: Bitcoin ARK and RGB smart contracts roadmap added

### Fixed
- Mining preimage format compatibility with webcash.org and C++ webminer
- Android WebGPU buffer mapping crash
- Recovery duplicate outputs
- Dark mode two-tone background flash
- Mobile auto-zoom on input focus
- Passkey persistence across sessions

## [0.1.0] - 2026-04-16

### Added
- Wallet creation with HD master secret generation (BIP32-style, 4 chain codes)
- Insert, pay, check, merge operations via webcash protocol
- Testnet CPU mining in Web Worker with live hash rate display
- Password encryption (Argon2id + AES-256-GCM) compatible with native webylib
- WebAuthn passkey encryption for biometric wallet unlock
- Wallet recovery from master secret, JSON snapshot, or encrypted backup
- Discrete backup warning banner (non-intrusive, session-dismissable)
- PWA manifest for installable standalone app
- Pure functional core with declarative Svelte 5 UI
- Same theme as weby.cash frontend (Raleway, HSL color system, dark mode)
- GitHub Pages deployment via GitHub Actions on release
