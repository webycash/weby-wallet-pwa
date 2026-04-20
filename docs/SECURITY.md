# Security

## Encryption at Rest

### Password Encryption

- **Key derivation**: PBKDF2 with SHA-256, 100,000 iterations
- **Encryption**: AES-256-GCM (authenticated encryption)
- **Salt**: 32 random bytes (unique per encryption)
- **Nonce**: 12 random bytes (unique per encryption)
- **Storage**: Encrypted blob stored in localStorage with salt + nonce metadata

### WebAuthn Passkey Encryption

- **Authentication**: Platform authenticator (Face ID, Touch ID, fingerprint)
- **Key derivation**: PRF extension output → AES-256 key (or fallback: SHA-256 of credential rawId)
- **Encryption**: AES-256-GCM (same as password path)
- **Resident key**: Required (discoverable credential)
- **User verification**: Required (biometric or PIN)

### What Gets Encrypted

The wallet snapshot (exported JSON containing all secrets and state) is encrypted before persisting to localStorage. This protects against:
- Physical device access (stolen laptop/phone)
- Browser extension attacks reading localStorage
- Cross-site scripting accessing storage

IndexedDB stores operational state (balances, depths) but not raw secrets.

## Recovery Methods

### Master Secret Recovery

The most powerful recovery method. From the master secret (hex or mnemonic), the wallet can:
1. Re-derive all chain secrets (RECEIVE, PAY, CHANGE, MINING)
2. Scan the server for unspent outputs at each derived address
3. Reconstruct the full wallet state

**Recovery gap limit**: Scans up to N unused consecutive depths per chain (default: 20). Increase if funds were received at higher indices.

### JSON Snapshot Recovery

Import a previously exported wallet snapshot. Contains:
- All unspent output secrets with amounts
- Spent output hashes
- Current chain depths
- Created timestamps

### Full Backup Recovery

Import a complete backup containing:
- Master HarmoniiStore state (HD keychain, all wallet metadata)
- All labeled webcash wallet states
- Chain depths and output history

### Encrypted File Recovery (.webcash format)

Import wallet files encrypted with CryptoJS AES-256-CBC:
- Uses OpenSSL EVP_BytesToKey key derivation (MD5-based)
- Compatible with the Python webcash wallet export format
- Decrypted content contains wallet snapshot JSON

## Threat Model

### Protected Against

- **Eavesdropping**: All server communication over HTTPS/TLS
- **Device theft**: Wallet encrypted at rest (password or biometric)
- **Server compromise of secrets**: Server never sees secret webcash strings (only public hashes)
- **Memory inspection**: Rust WASM zeroes all secret material on drop (zeroize crate)
- **Supply chain**: WASM module integrity verified by service worker hash

### Not Protected Against

- **Server collusion**: The webcash server is trusted (centralized model)
- **Compromised device with active session**: If malware has access while wallet is unlocked
- **Lost master secret**: No recovery possible without the master secret or a backup
- **Browser zero-day**: A browser exploit could access WASM memory

## Key Material Lifecycle

1. **Generation**: Master secret created via `crypto.getRandomValues()` (browser CSPRNG)
2. **Storage**: Encrypted in localStorage (never plaintext on disk)
3. **Use**: Decrypted into WASM memory for operations, zeroed after
4. **Backup**: Exported as mnemonic or hex (user responsibility to store safely)
5. **Deletion**: Wallet reset zeroes all stores (IndexedDB + localStorage)

## Network Security

- All webcash server calls use HTTPS with TLS 1.2+
- No cookies, tokens, or session state sent to server
- Server only receives public hashes (health_check) or replace operations
- No analytics, tracking, or third-party requests
- Service worker caches all assets for offline use
