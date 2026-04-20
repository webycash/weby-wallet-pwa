# Mining

## Overview

Webcash mining is proof-of-work: find a nonce such that `SHA256(preimage)` has enough leading zero bits to meet the server's difficulty target. A successful solution mints new webcash directly into the miner's wallet.

## GPU Mining (WebGPU)

The primary mining backend uses WebGPU (via wgpu compiled to WASM). This provides GPU-accelerated SHA256 hashing directly in the browser.

**Requirements:**
- Chrome 113+ / Edge 113+ with WebGPU enabled
- A discrete or integrated GPU

**Flow:**
1. Wallet fetches current mining target from server (`GET /target`)
2. Derives a mining secret from the HD wallet (MINING chain at current depth)
3. Constructs the preimage template (JSON with webcash outputs, difficulty, timestamp)
4. GPU iterates nonces in parallel until a valid hash is found
5. Solution is submitted to the server (`POST /mining_report`)
6. Server validates and mints the webcash (output is already keyed to wallet's derived secret)

**Performance:**
- Desktop GPUs: 100-500+ MH/s depending on hardware
- Integrated GPUs: 10-50 MH/s
- Mining runs continuously until stopped by the user

## CPU Mining (Legacy)

A Web Worker-based CPU miner is available as fallback (primarily for testnet):

- Runs in a dedicated Web Worker thread (non-blocking UI)
- Reports progress every 400ms with hash rate and ETA
- Significantly slower than GPU (~1-5 MH/s on modern CPUs)

## Preimage Format

The mining preimage is a JSON object:

```json
{
  "webcash": ["e50.00000000:secret:<mining_derived_secret>"],
  "subsidy": [],
  "timestamp": 1713700000,
  "difficulty": 28,
  "nonce": 12345678
}
```

The SHA256 hash of this JSON string (encoded as bytes) must have at least `difficulty` leading zero bits.

## Mining Secret Derivation

The mining output secret is derived deterministically:

```
tag = SHA256("webcashwalletv1")
mining_secret = SHA256(tag || tag || master_secret || 3_be64 || depth_be64)
```

This means:
- Mined webcash is immediately owned by the wallet (no insert needed)
- Recovery can find mined outputs by scanning the MINING chain
- No private key transmission occurs during mining

## Difficulty and Rewards

- **Difficulty**: Number of leading zero bits required (higher = harder)
- **Mining amount**: Webcash minted per valid solution
- **Subsidy**: Optional additional reward (can be 0)
- **Dynamic adjustment**: Production server adjusts difficulty based on solution rate
- **Testnet**: Fixed low difficulty for testing (difficulty 16 = ~65k attempts)

## Mining in the PWA

The MinerPanel component provides:
- GPU detection and initialization status
- Start/stop controls
- Live hash rate display
- Solution count and total mined amount
- Mining history

Mining state persists across page reloads. The miner automatically pauses when the tab is backgrounded (browser throttling) and resumes when foregrounded.
