# HD Wallet — Deterministic Key Derivation

## Overview

The wallet uses BIP32-style hierarchical deterministic key derivation. A single master secret generates an unlimited number of child keys across four chain codes. This allows full wallet recovery from just the master secret (or its BIP39 mnemonic encoding).

## Master Secret

The master secret is a random 32-byte value (256 bits of entropy), represented as a 64-character hex string. It can be:

- **Generated** fresh during wallet creation
- **Imported** from a BIP39 mnemonic (12+ words)
- **Imported** from a 64-character hex string

The master secret is the root of all derived keys. Losing it means losing access to all funds. The PWA stores it encrypted in the browser (password or passkey protection).

## Derivation Algorithm

```
tag    = SHA256("webcashwalletv1")
secret = SHA256(tag || tag || master_secret || chain_code_be64 || depth_be64)
```

Where:
- `tag` is the fixed domain separator (32 bytes)
- `master_secret` is the 32-byte root key
- `chain_code_be64` is the chain code as a big-endian 64-bit integer
- `depth_be64` is the derivation index as a big-endian 64-bit integer
- `||` denotes concatenation

This matches the Python reference implementation at [kanzure/webcash](https://github.com/kanzure/webcash).

## Chain Codes

| Chain | Value | Purpose | Usage |
|-------|-------|---------|-------|
| RECEIVE | 0 | Incoming payments | Server assigns outputs to RECEIVE[depth] secrets |
| PAY | 1 | Payment outputs | Generated during `pay` operations |
| CHANGE | 2 | Transaction change | Generated during `pay` to return excess value |
| MINING | 3 | Mining rewards | Used in proof-of-work preimages |

Each chain maintains its own depth counter. Depths increment after each successful server operation.

## Multi-Wallet (Labeled Wallets)

The `harmoniis-wallet` engine extends this with a family+label system:

```
Mnemonic → HdKeychain
         → derive_wallet_secret("webcash", "main")   → master for main webcash wallet
         → derive_wallet_secret("webcash", "savings") → master for savings webcash wallet
         → derive_wallet_secret("bitcoin", "main")   → seed for Bitcoin wallet
```

Each labeled wallet has its own independent set of chain depths and outputs.

## Recovery

Recovery scans each chain code from depth 0 up to a configurable gap limit (default: 20). For each derived secret, the wallet checks the server for unspent outputs. If found, the output is reclaimed into the wallet.

The process:
1. Derive `RECEIVE[0..gap_limit]` — find received funds
2. Derive `PAY[0..gap_limit]` — find unclaimed payment outputs
3. Derive `CHANGE[0..gap_limit]` — find unredeemed change
4. Derive `MINING[0..gap_limit]` — find mined webcash

Recovery is non-destructive: it only discovers existing unspent outputs on the server.

## BIP39 Mnemonic

The master secret can be encoded as a BIP39 mnemonic phrase (12-24 words) for human-friendly backup. The mapping:

- **Export**: `hex_entropy → mnemonic_words`
- **Import**: `mnemonic_words → hex_entropy → master_secret`

The mnemonic provides the same 256 bits of entropy as the raw hex, just in a more memorable format.

## Security Properties

- **Deterministic**: Same master secret always produces the same child keys
- **One-way**: Child keys cannot reveal the master secret
- **Independent chains**: Compromising one chain code does not affect others
- **Gap limit**: Recovery will miss outputs beyond the scan depth (configurable)
- **Zeroize**: All secret material is zeroed from memory after use (Rust WASM)
