# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
