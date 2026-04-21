# Key Model — Master Wallet, Slot Families, and Webcash Derivation

## Three-Level Hierarchy

The wallet uses a **3-level key hierarchy**. Understanding these levels is essential:

```
Level 1: MASTER WALLET    BIP39 mnemonic → BIP32 hardened slots
Level 2: SLOT FAMILIES    Each slot = independent 32-byte secret for one purpose
Level 3: WEBCASH CHAINS   Each webcash slot → 4 independent SHA256 chains
```

The master wallet is NOT a webcash wallet. It is a keychain that *contains* webcash wallets, bitcoin wallets, RGB identities, voucher wallets, and PGP signing keys as derived slots. Each slot family serves a different purpose and has its own database.

---

## Level 1: Master Wallet (harmoniis-wallet)

The master wallet holds a single **BIP39 mnemonic** (24 words, 256-bit entropy). From this mnemonic, all other keys are deterministically derived.

### Generation

1. Generate 32 bytes of random entropy
2. Encode as BIP39 mnemonic (24 words)
3. Convert to BIP32 seed: `seed = PBKDF2-SHA512(mnemonic, "mnemonic", 2048 rounds)`
4. Derive BIP32 master extended private key from seed

### Slot Derivation Path

```
m / 83696968' / 0' / family' / index'
```

Where:
- `83696968` (0xFAFAFAF8) = Harmoniis purpose constant (hardened)
- `0` = main application (hardened)
- `family` = slot family code (hardened, see below)
- `index` = slot number within the family (hardened, 0 = "main")

All derivations use **hardened BIP32** — no public key derivation, no chain code leakage between slots.

### What the Master Wallet Stores

The master database (`master.db` on native, IndexedDB on WASM) contains:
- Root entropy (mnemonic + hex)
- Wallet slot registry (family, index, label, database path)
- PGP identity registry (labels, public keys, active flag)
- Payment audit trail
- RGB contracts and certificates

The master wallet does **not** store webcash balances, bitcoin UTXOs, voucher credits, or any funds. Those live in per-slot databases.

---

## Level 2: Slot Families

Each family has a unique code and derives independent 32-byte secrets:

| Family | Code | Max Slots | Purpose |
|--------|------|-----------|---------|
| **webcash** | 2 | 256 | Webcash bearer e-cash (→ webylib 4-chain HD) |
| **bitcoin** | 3 | 256 | On-chain Bitcoin (→ BIP86 Taproot / BIP84 SegWit) |
| **rgb** | 1 | 256 | RGB smart contract identity |
| **voucher** | 6 | 256 | Voucher bearer credits |
| **pgp** | 4 | 1000 | Ed25519 signing identities |

### Webcash Slots

Each webcash slot produces a 32-byte master secret that initializes a webylib HDWallet with 4 independent SHA256 chains (see Level 3 below). This is where webcash funds live — insert, pay, check, merge, mine, recover all happen within a webcash slot.

### Bitcoin Slots

Each bitcoin slot derives a 32-byte seed that initializes a BDK wallet with:
- **BIP86** (Taproot) as the primary receive path
- **BIP84** (SegWit) as compatibility fallback

ARK protocol support (off-chain VTXOs via Arkade ASP) extends the bitcoin wallet with off-chain deposits, settlements, and VTXO proof verification.

### RGB Slots

Each RGB slot derives an identity key for client-side validated smart contracts. RGB contracts are state owned by the holder and validated locally — the blockchain (or other witness service) only anchors commitments.

Weby supports multiple witness backends for RGB:
- **Bitcoin blockchain** — standard RGB anchoring via Bitcoin transactions
- **Webcash Witness** — witness service using webcash replace semantics
- **Harmoniis Witness** — marketplace witness for contract arbitration
- **Any provider** implementing `webycash-witness-server`

### Voucher Slots

Each voucher slot derives a master secret for bearer credit management. Vouchers are issued by voucher service providers running `webycash-voucher-server`. Voucher outputs are bearer secrets — the holder owns the credits.

### PGP Keys

The master wallet derives up to 1000 PGP signing identities (Ed25519). These are used for:
- Marketplace identity registration
- Post and contract signing
- Fingerprint-based authentication

```
pgp[0] → default signing identity
pgp[1] → "ops-signing" labeled identity
...
pgp[999] → last available slot
```

PGP identities are stored in the master database. Switching the active PGP label changes which key signs operations, but does **not** change which webcash/bitcoin/RGB wallet is used.

### Labeled Wallets (Multi-Wallet)

Within each family, multiple **labeled wallets** can exist at different slot indices:

```
webcash[0] → "main" webcash wallet       (main_webcash.db)
webcash[1] → "savings" webcash wallet    (savings_webcash.db)
webcash[2] → "cloudminer" wallet         (cloudminer_webcash.db)
bitcoin[0] → "main" bitcoin wallet       (main_bitcoin.db)
voucher[0] → "main" voucher wallet       (main_voucher.db)
```

Each labeled wallet is a completely independent BIP32 derivation. The label is human-friendly metadata; the slot index determines the cryptographic path. The same mnemonic always produces the same wallet at each index.

---

## Level 3: Webcash 4-Chain Derivation (webylib)

A webcash slot produces a 32-byte master secret. This secret initializes a **webylib HDWallet** which has its own independent derivation scheme — **not BIP32**, but SHA256-based:

### Chain Codes

| Chain | Value | Purpose |
|-------|-------|---------|
| RECEIVE | 0 | Incoming payment secrets |
| PAY | 1 | Outgoing payment outputs |
| CHANGE | 2 | Transaction change |
| MINING | 3 | Mining reward collection |

### Derivation Algorithm

```
tag    = SHA256("webcashwalletv1")
secret = SHA256(tag || tag || webcash_master_secret || chain_code_be64 || depth_be64)
```

This is **not** BIP32. Once you have the webcash master secret (from the BIP32 slot), each chain derives fresh secrets at each depth using double-tagged SHA256:

- `tag` = fixed 32-byte domain separator
- `webcash_master_secret` = 32 bytes (from Level 2 slot derivation)
- `chain_code` = 64-bit big-endian (0, 1, 2, or 3)
- `depth` = 64-bit big-endian (increments after each use)

This matches the [Python webcash reference implementation](https://github.com/kanzure/webcash).

### Depth Management

Each chain maintains its own depth counter. After a successful server operation, the depth increments atomically. This ensures:
- No secret is ever reused (each depth produces a unique key)
- Recovery can scan depths 0..gap_limit to find used secrets
- Depths are stored per-wallet in the webcash database (not the master DB)

### How Operations Use Chains

| Operation | Chain Used | What Happens |
|-----------|-----------|--------------|
| **Insert** | RECEIVE | Received webcash is re-keyed to RECEIVE[next_depth] via `/replace` |
| **Pay** | PAY + CHANGE | Payment output at PAY[next_depth], change at CHANGE[next_depth] |
| **Merge** | CHANGE | Multiple outputs merged into CHANGE[next_depth] |
| **Mine** | MINING | Mining preimage uses MINING[next_depth] as the reward secret |
| **Recover** | All 4 | Scans all chains from depth 0 to gap_limit |

---

## Recovery

### From Mnemonic (Full Recovery)

With just the 24-word mnemonic, the wallet can reconstruct everything:

1. Derive master BIP32 key from mnemonic
2. Derive all slot families at their known indices
3. For each webcash slot: scan all 4 chains up to the gap limit (default: 20)
4. For each voucher slot: re-insert exported voucher secrets
5. For PGP slots: scan indices 0..999 and match against marketplace
6. For bitcoin: sync via Esplora/Electrum

### From Webcash Master Secret (Webcash Only)

If you have a webcash slot's 64-char hex secret (not the mnemonic), you can recover only that webcash wallet's funds by scanning the 4 chains. Other families (bitcoin, RGB, vouchers, PGP) are not recoverable from a webcash secret alone.

### Gap Limit

Recovery scans consecutive unused depths per chain. If 20 consecutive depths have no server-known outputs, scanning stops. Increase the gap limit if funds were received at higher indices.

---

## Visual Summary

```
BIP39 Mnemonic (24 words)
│
└─ BIP32 seed → master_xpriv
   │
   └─ m/83696968'/0'/ (Harmoniis purpose)
      │
      ├─ /1'/0' ─── rgb[0]      → RGB contract identity
      ├─ /2'/0' ─── webcash[0]  → 32-byte webcash master ──┐
      ├─ /2'/1' ─── webcash[1]  → 32-byte (labeled wallet) │
      ├─ /3'/0' ─── bitcoin[0]  → BIP86/BIP84 seed         │
      ├─ /4'/0' ─── pgp[0]      → Ed25519 signing key      │
      ├─ /4'/1' ─── pgp[1]      → Ed25519 (labeled)        │
      └─ /6'/0' ─── voucher[0]  → voucher master            │
                                                             │
         ┌───────────────────────────────────────────────────┘
         │  webylib HDWallet (SHA256-based, NOT BIP32)
         │
         ├─ RECEIVE chain (0) ── depth 0, 1, 2, ... → payment receive secrets
         ├─ PAY chain     (1) ── depth 0, 1, 2, ... → payment output secrets
         ├─ CHANGE chain  (2) ── depth 0, 1, 2, ... → transaction change secrets
         └─ MINING chain  (3) ── depth 0, 1, 2, ... → mining reward secrets

         Each: SHA256(tag || tag || webcash_master || chain_be64 || depth_be64)
```
