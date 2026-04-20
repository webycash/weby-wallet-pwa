# Webcash Protocol

## Overview

Webcash is a centralized electronic cash system. Value exists as cryptographic strings that can be spent exactly once. A central server ([webcash.org](https://webcash.org)) validates all transactions and prevents double-spending.

Unlike decentralized cryptocurrencies, webcash relies on a single trusted mint. This makes transactions instant, final, and requires no blockchain synchronization. Privacy comes from the bearer instrument model: the server only sees hashed public values, never the secrets themselves.

## Webcash String Format

```
e{amount}:{type}:{value}
```

| Type | Example | Description |
|------|---------|-------------|
| `secret` | `e1.00000000:secret:a1b2c3...` | Private — the holder owns the value |
| `public` | `e1.00000000:public:d4e5f6...` | Public — SHA256 hash of the secret, stored on server |

**Rules:**
- Amounts use up to 8 decimal places (1 webcash = 100,000,000 wats)
- Secrets are 32 bytes (64 hex characters)
- Public hash: `SHA256(secret_ascii_hex_bytes)` — hash the ASCII hex string, not decoded bytes
- Amounts must be positive and non-zero
- Total precision: up to ~21 million webcash (same supply model as Bitcoin)

## Server API

**Production:** `https://webcash.org/api/v1/`
**Testnet:** `https://weby.cash/api/webcash/testnet/api/v1/`

### POST `/replace`

The core transaction operation. Atomically spends input webcash and creates new output webcash. Total input amount must equal total output amount (conservation of value).

```json
{
  "webcashes": ["e3.00000000:secret:input_hex_1...", "e2.00000000:secret:input_hex_2..."],
  "new_webcashes": ["e4.00000000:secret:output_hex_1...", "e1.00000000:secret:change_hex..."],
  "legalese": { "terms": true }
}
```

**Use cases:**
- **Payment**: Split existing webcash into payment + change
- **Merge**: Combine multiple small outputs into one
- **Transfer**: Re-key webcash to a new secret (rotate ownership)

### POST `/health_check`

Query spend status of public webcash strings.

```json
["e1.00000000:public:hash1...", "e2.00000000:public:hash2..."]
```

Response indicates whether each output is spent or unspent.

### GET `/target`

Current mining difficulty and reward parameters.

```json
{
  "difficulty_target_bits": 28,
  "mining_amount": "50.00000000",
  "mining_subsidy_amount": "0.00000000"
}
```

### POST `/mining_report`

Submit proof-of-work solution to mint new webcash.

```json
{
  "preimage": "<base64-encoded-json-with-nonce>",
  "legalese": { "terms": true }
}
```

The preimage contains the SHA256 work proof. If the hash has enough leading zero bits (meeting the difficulty target), the server mints the webcash outputs declared in the preimage.

## Trust Model

- **Server trust**: The webcash server is trusted to maintain the ledger honestly
- **Bearer instrument**: Whoever holds the secret owns the value — no accounts, no identity
- **Double-spend prevention**: The server rejects any attempt to spend already-spent outputs
- **Privacy**: Secrets never leave the client; the server only sees public hashes during health checks
- **Atomicity**: Replace operations are all-or-nothing — inputs are only spent if outputs are valid

## Amount Precision

- 1 webcash = 100,000,000 wats (8 decimal places)
- Minimum transferable: 0.00000001 webcash (1 wat)
- Amounts stored as 64-bit integers internally (overflow-safe arithmetic)
