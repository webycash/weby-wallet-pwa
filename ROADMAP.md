# Roadmap

## v0.1.0 — Foundation (complete)

- [x] Wallet CRUD operations (create, insert, pay, check, merge)
- [x] Master wallet with BIP39 mnemonic and BIP32 slot derivation
- [x] Webcash 4-chain HD derivation (RECEIVE, PAY, CHANGE, MINING)
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

## v0.2.0 — Polish (complete)

- [x] QR code scanning for webcash insert (camera)
- [x] Multi-wallet UI (switch between labeled wallets)
- [x] Proper PNG icons (192, 512, maskable)
- [x] Service worker with full offline precaching

## v0.3.0 — Bitcoin, RGB, and Vouchers

- [ ] Transaction history with timestamps
- [ ] Bitcoin ARK protocol support (off-chain VTXOs via Arkade ASP)
- [ ] On-chain Bitcoin receive/send (BIP86 Taproot + BIP84 SegWit)
- [ ] ARK deposit, boarding, balance, send, settle operations
- [ ] RGB smart contracts — client-side validated state
- [ ] Multiple witness backends:
  - Bitcoin blockchain (standard RGB anchoring)
  - Webcash Witness (webcash replace semantics)
  - Harmoniis Witness (marketplace arbitration)
  - Any provider implementing `webycash-witness-server`
- [ ] Voucher wallet (bearer credits from voucher service providers via `webycash-voucher-server`)
- [ ] Contract issuance, transfer, and certificate viewing
- [ ] Unified balance view across webcash, bitcoin, and vouchers
- [ ] VTXO proof verification in browser

## v0.4.0 — Advanced

- [ ] P2P exchange with RGB contracts and zero-knowledge proofs (ZKP)
- [ ] Contract marketplace integration (Harmoniis)
- [ ] Multi-device sync via encrypted backup
- [ ] Payment request deep links
- [ ] Push notifications for mining results
- [ ] Cross-rail payments (webcash <-> bitcoin <-> voucher)
- [ ] RGB asset portfolio dashboard
- [ ] Hardware wallet integration (WebUSB/WebHID)
- [ ] Atomic swaps across payment rails
