# Development Plan: Webycash Exchange Module PWA

Status: planning document, no implementation started.

The DEX/orderbook mechanism is implemented here as a Webycash PWA module
extension. It consumes reusable `extro-402-scheme` primitives from `extro-node`.
It does not move Webycash exchange business logic into `extro-node`.

## Goals

- Replace the current Webcash-only WASM dependency path with an
  `extro-node` WASM client facade.
- Add a Webycash exchange module that publishes and listens for offers through
  Extro orderbook/DHTX/torrent mechanisms.
- Support a Webycash-branded wallet bundle and cross-domain `extro.network`
  wallet access through adapters and permissions.
- Provide a professional wallet UI for rails, orderbook, trades, referee status,
  and push-driven settlement events.

## Non-Goals

- Do not implement generic Extro 402 primitives in the PWA.
- Do not implement the Cloudflare referee in the PWA.
- Do not centralize order matching in the PWA.
- Do not expose raw bearer secrets to UI components except for existing explicit
  send/export flows.

## Current Constraints

Current state:

- `src/lib/stores/wallet.svelte.ts` assumes a JSON API from the current
  `wallet-wasm` wrapper.
- `crates/wallet-wasm/src/lib.rs` delegates to `harmoniis-wallet`.
- RGB and Voucher UI entries exist but are disabled.
- Service worker exists, but not as a referee/keyserver push hook executor.

Migration must be staged. A direct replacement of the WASM import will break
state, backup, mining, and wallet operations.

## Module Architecture

Proposed structure:

```text
src/lib/extro/
  client.ts
  commands.ts
  permissions.ts
  local-node.ts
  cross-domain-node.ts

src/lib/modules/webycash-exchange/
  index.ts
  types.ts
  pair-policy.ts
  orderbook-store.svelte.ts
  trade-store.svelte.ts
  referee-client.ts
  publication-fee.ts
  push-hooks.ts
  components/

src/lib/components/exchange/
  OrderBook.svelte
  NewOrderPanel.svelte
  MarketOrderPanel.svelte
  TradeStatus.svelte
  RefereeTimeline.svelte
  PublishFeePreview.svelte
  PairSelector.svelte
```

The module calls `extro-node` through a typed facade. The facade can target:

- local bundled WASM node;
- cross-domain `extro.network` wallet bridge;
- Webycash-branded hosted wallet bridge.

## Exchange Module Responsibilities

### Orderbook

- Subscribe to signed limit orders from Extro/DHTX/orderbook torrent.
- Verify order signatures.
- Verify pair policy.
- Reject expired orders.
- Sort bids descending by price.
- Sort asks ascending by price.
- Compute spread from local best bid and best ask.
- Present local liquidity with freshness/source indicators.

### Publishing orders

Publishing an order requires:

1. Build signed limit order.
2. Discover active seeders.
3. Compute 0.1 percent publish fee.
4. Split fee equally among active seeders.
5. Pay each seeder using Webcash or Bitcoin ARK only.
6. Collect publication fee receipts.
7. Publish order plus receipts to the orderbook torrent.

The module must show fee preview before publishing.

### Market orders

Market order flow:

1. User chooses pair, side, amount, and slippage/cap.
2. Module walks locally observed book.
3. Module selects one or more limit orders.
4. Module creates exact fill requests per maker order.
5. Module invokes `extro-402-scheme` order-request primitive.
6. Module opens one trade timeline per fill.

Partial fill behavior:

- If Alice has 100 Webcash and Bob wants 1000 Webcash, a market buy consumes
  Alice's 100 first, then walks to the next best ask.
- The UI must show partial fills and remaining requested amount.

### Limit orders

Limit order flow:

- User chooses pair, side, price, amount, expiry, and accepted referee policy.
- Module computes whether the pair is allowed.
- Module requests exact rail preparation from `extro-node`.
- Module publishes only signed commitments, never secrets.

### Pair policy

The module must enforce:

- Webcash <-> Voucher: blocked.
- Bearer <-> Bearer without ARK/RGB conditional side: blocked.
- Webcash/Voucher <-> ARK: referee required.
- RGB <-> Webcash/Voucher: allowed only with explicit race-bounded warning and
  RGB conditional leg.
- RGB <-> RGB: prefer RGB server atomic/conditional route, no referee if safe.

### Referee interaction

The module talks to `webycash-referee` for flows that require mediation.
It must not treat the referee as custody.

Referee timeline states:

- order selected;
- order request sent;
- maker response received;
- ZKP verified by referee;
- pre-check passed;
- recipient 402/push delivered;
- post-check passed;
- ARK release/refund issued;
- completed, failed, refunded, or canceled.

## Push Hooks

The PWA service worker must route incoming keyserver push messages to the
exchange module and then to `extro-node` hook commands.

Required hooks:

- insert encrypted bearer payload;
- invalidate public hash;
- release ARK settle;
- release ARK refund;
- order request received;
- fail-to-deliver received;
- signed ack callback.

Queueing rules:

- Store only ciphertext, hashes, ids, and signatures while locked.
- Deduplicate by `(swap_id, kind, payload_hash)`.
- Replay when the wallet is unlocked or secure hook execution is available.
- Show user-visible risk state if invalidation is queued too long.

## Visual Development Plan

The wallet should become a dense, operational app, not a marketing page.

Primary views:

- Wallet dashboard: balances by rail, pending hooks, last trades.
- Webcash: existing receive/send/verify/merge/mining flows.
- Assets: RGB20/RGB21/Voucher inventory and health status.
- Exchange: pair selector, orderbook, order ticket, active trades.
- Trade detail: timeline, audit events, referee messages, push status.
- Settings: identity, keyserver, module permissions, backup/Shamir, referee
  trust pins.

Interaction rules:

- Use compact tables for orderbook and trade history.
- Use clear status chips for pending/settled/refunded/failed.
- Use side panels for order tickets on desktop and bottom sheets on mobile.
- Keep secrets hidden by default.
- Every destructive or irreversible action needs explicit confirmation.
- Warn clearly when a pair is race-bounded rather than cryptographically
  atomic.

## State Migration

Migration from current `harmoniis-wallet` JSON state:

1. Add `extro` client facade while preserving existing wallet store.
2. Add a compatibility adapter that maps current functions to
   `ExtroCommand`.
3. Migrate master wallet and mnemonic handling to `extro-node`.
4. Migrate Webcash wallet state.
5. Add Shamir backup/recovery UI.
6. Enable Voucher/RGB/ARK views only after rail commands exist.
7. Remove old wrapper only after backup/import/recovery tests pass.

## Security Gates

- No module can access wallet hooks without capability grant.
- No UI component receives plaintext payloads unless the command is a user
  export/send action.
- All referee messages verify pinned referee key.
- All order messages verify maker signature and expiry.
- All keyserver push messages verify sender/follow policy through the
  `extro-node` command surface.
- Fail-to-deliver and invalidate hooks are idempotent.
- UI displays exact pair settlement model before order confirmation.

## Tests

Required before production:

- deterministic Ark settle and timeout-recovery transaction/signature tests;
- two-wallet Ark regtest and signet balance/outpoint evidence;
- unit tests for pair policy;
- orderbook sorting tests;
- market order walking tests;
- publication fee split tests for 1, 2, 10, and 0 seeders;
- service worker push dedupe tests;
- mocked referee happy/fail/refund tests;
- mobile and desktop visual screenshots;
- backup/restore migration tests;
- locked-wallet hook queue tests.

## Implementation Order

1. Add this module plan and route-level design.
2. Build `extro` client facade against a mocked `extro-node` command surface.
3. Add exchange module stores and mock orderbook.
4. Add visual orderbook/order ticket/trade timeline.
5. Add service-worker push routing with mock payloads.
6. Integrate real `extro-node` WASM command dispatch.
7. Integrate `webycash-referee` testnet endpoints.
8. Enable real order publication and market order flow only after security
   audit.

## Agent Prompt

Use `docs/agent-prompts/01-webycash-exchange-module.md` for the implementation
agent assigned to this repository.
