# Payments and Roaming Wallets

## Share Payments

### Creating a Payment

When you pay someone webcash:

1. Enter the amount in the PayForm component
2. The wallet calls `payWebcash(amount_wats)` on the WASM engine
3. The engine performs a `/replace` operation:
   - **Input**: One or more unspent outputs totaling >= amount
   - **Output**: Payment output (exact amount) + change output (remainder)
4. The payment secret is extracted: `e{amount}:secret:{hex}`
5. Displayed as a QR code and copyable text

### Receiving a Payment

Recipients claim payments by inserting the secret webcash string:

1. Paste or scan the `e{amount}:secret:{hex}` string in InsertForm
2. The wallet calls `insertWebcash(secret_string)` on the WASM engine
3. The engine performs a `/replace` operation:
   - **Input**: The received secret webcash
   - **Output**: A new secret derived from the wallet's RECEIVE chain
4. The webcash is now owned by the recipient's HD wallet (recoverable)

### Payment Links

Payments can be shared as URLs for the PWA:
```
https://webycash.github.io/weby-wallet-pwa/wallet?receive=e1.00000000:secret:abcdef...
```

The ReceiveGift component handles incoming payment links.

## Roaming Wallets

Roaming wallets are imported from external sources (files, other wallet software). They differ from HD-derived wallets:

| Property | HD Wallet | Roaming Wallet |
|----------|-----------|----------------|
| Derived from master | Yes | No |
| Recoverable from mnemonic | Yes | No |
| Mining capable | Yes | No |
| Created via | Setup wizard | File import |
| Backed up via | Master secret | Explicit snapshot export |

### Importing a Roaming Wallet

1. **Plaintext `.webcash` file**: JSON containing unspent outputs + depths
2. **Encrypted `.webcash` file**: CryptoJS AES-256-CBC encrypted JSON (password prompted)

The import creates a new wallet entry marked `roaming: true` in the wallet registry. Its outputs are stored in IndexedDB but cannot be regenerated from the master secret.

### Webcasa Format

The `.webcash` file format (parsed by `webcasa.ts`):

```json
{
  "unspent": ["e1.00000000:secret:abc...", "e0.50000000:secret:def..."],
  "spent": ["sha256hash1...", "sha256hash2..."],
  "depths": { "RECEIVE": 5, "PAY": 3, "CHANGE": 2, "MINING": 0 }
}
```

Encrypted files use CryptoJS with OpenSSL-compatible key derivation:
- Detect `Salted__` prefix (8 bytes)
- Extract 8-byte salt
- EVP_BytesToKey: iterative MD5 to derive key + IV from password + salt
- AES-256-CBC decryption
- Parse resulting JSON

## Wallet Operations Summary

| Operation | What it does | Server call |
|-----------|-------------|-------------|
| **Insert** | Claim received webcash into wallet | `/replace` (re-key to HD secret) |
| **Pay** | Create payment for recipient | `/replace` (split into payment + change) |
| **Check** | Verify outputs are still unspent | `/health_check` |
| **Merge** | Consolidate many outputs into fewer | `/replace` (many inputs → few outputs) |
| **Recover** | Scan server for HD-derived outputs | `/health_check` (batch scan) |
| **Mine** | Find PoW solution to mint webcash | `/mining_report` |

## Multi-Wallet Management

The SettingsPanel provides:
- List all wallets (HD + roaming)
- Add new labeled wallets
- Remove wallets (with confirmation)
- Rename wallets
- Export individual wallet snapshots
- Import full backups
