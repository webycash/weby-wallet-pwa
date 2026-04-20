# Roadmap

## v0.1.0 — Foundation (complete)

- [x] Wallet CRUD operations (create, insert, pay, check, merge)
- [x] HD key derivation (RECEIVE, PAY, CHANGE, MINING chains)
- [x] Password encryption (PBKDF2 + AES-256-GCM)
- [x] WebAuthn passkey encryption (biometric)
- [x] WebGPU mining (GPU-accelerated proof-of-work)
- [x] Master secret recovery (mnemonic + hex)
- [x] JSON snapshot export/import
- [x] Full backup export/import
- [x] Roaming wallet import (.webcash files)
- [x] Share payments (QR code + copy)
- [x] PWA manifest and offline support
- [x] GitHub Pages CI/CD
- [x] Multi-wallet support (labeled wallets)
- [x] Production + testnet network toggle

## v0.2.0 — Polish

- [ ] QR code scanning for webcash insert (camera)
- [ ] Transaction history with timestamps
- [ ] Multi-wallet UI improvements (quick switch)
- [ ] Service worker with full offline precaching
- [ ] Proper PNG icons (192, 512, maskable)

## v0.3.0 — Bitcoin ARK Integration

- [ ] Bitcoin ARK protocol support (off-chain VTXOs via Arkade ASP)
- [ ] On-chain Bitcoin receive/send (BIP86 Taproot + BIP84 SegWit)
- [ ] ARK deposit, boarding, balance, send, settle operations
- [ ] Unified balance view across webcash + Bitcoin
- [ ] VTXO proof verification in browser

## v0.4.0 — RGB Smart Contracts (Client-Side Validated)

- [ ] RGB contract state management (client-side validation)
- [ ] Witness-backed bearer state (replace semantics)
- [ ] Contract issuance UI (define assets/tokens)
- [ ] Contract transfer and atomic swap
- [ ] Certificate viewing and verification
- [ ] Contract marketplace integration (Harmoniis)

## v0.5.0 — Advanced

- [ ] Multi-device sync via encrypted backup
- [ ] Payment request deep links
- [ ] Push notifications for mining results
- [ ] RGB asset portfolio dashboard
- [ ] Cross-rail payments (webcash <-> Bitcoin <-> voucher)
- [ ] Hardware wallet integration (WebUSB/WebHID)
