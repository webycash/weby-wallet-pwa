# Agent Prompt: Webycash PWA Exchange Module

## Prompt

You are implementing the Webycash exchange module in
`/Users/george/workspace/webycash/weby-wallet-pwa`.

Read first:

- `docs/development-plan-webycash-exchange-module.md`
- `/Users/george/workspace/extro/docs/development/24-extro-402-scheme-and-webycash-plan.md`
- `/Users/george/workspace/extro/extro-node/docs/development-plan-extro-402-scheme.md`
- `/Users/george/workspace/webycash/webycash-referee/docs/development-plan.md`
- current `src/lib/stores/wallet.svelte.ts`, `crates/wallet-wasm/src/lib.rs`,
  service worker, and wallet components.

Branch:

```text
feature/webycash-exchange-module
```

Create the branch only after the coordinator/user authorizes implementation.

## Objective

Build the Webycash DEX/orderbook as a PWA module extension on top of
`extro-node` and `extro-402-scheme`. Do not move this DEX logic into
`extro-node`.

## Implementation Request

1. Add an `extro` client facade:
   - local bundled `extro-node` WASM adapter;
   - cross-domain `extro.network` wallet adapter;
   - mocked adapter for development/tests.

2. Add Webycash exchange module state:
   - orderbook store;
   - trade store;
   - referee client;
   - publication fee calculator;
   - pair-policy helper;
   - push hook router.

3. Add orderbook UI:
   - pair selector;
   - bid/ask tables;
   - spread display;
   - freshness/source labels;
   - empty/loading/error states.

4. Add order ticket UI:
   - limit order;
   - market order;
   - amount, price, expiry;
   - slippage/cap for market orders;
   - publication fee preview;
   - blocked-pair warning.

5. Add market-order book walking:
   - consume best price first;
   - support partial fills;
   - continue to next order until amount filled or cap hit;
   - produce exact fill requests.

6. Add publish-order flow:
   - discover/mock active seeders initially;
   - compute 0.1 percent publication fee;
   - split equally among active seeders;
   - accept Webcash or Bitcoin ARK fee rail only;
   - attach publication fee receipts.

7. Add trade timeline:
   - order selected;
   - request sent;
   - proof/referee pre-check;
   - delivery dispatched;
   - post-check;
   - settle/refund/fail-to-deliver;
   - terminal state.

8. Add service worker push routing:
   - insert encrypted bearer;
   - invalidate public hash;
   - release ARK settle;
   - release ARK refund;
   - fail-to-deliver;
   - signed ack callback.

## Design Constraints

- Keep Webycash DEX behavior in this repo.
- Do not implement generic 402 primitives here; call the `extro` facade.
- Do not implement referee state machine here; call `webycash-referee`.
- Do not expose plaintext secrets to Svelte components.
- Webcash <-> Voucher must be blocked in UI and logic.
- Race-bounded flows must be visibly labeled before confirmation.
- Push hooks must dedupe by `(swap_id, kind, payload_hash)`.

## Tests Required

Add tests for:

- pair policy rejects Webcash <-> Voucher.
- pair policy requires referee for Webcash/Voucher <-> ARK.
- orderbook bid sort descending.
- orderbook ask sort ascending.
- spread calculation.
- market order walks partial fills correctly.
- market order respects slippage/cap.
- publication fee split:
  - 1 seeder gets 0.1 percent;
  - 2 seeders get 0.05 percent each;
  - 10 seeders get 0.01 percent each;
  - 0 seeders blocks publishing or shows explicit no-seeder state.
- only Webcash and Bitcoin ARK are allowed for publication fee.
- push hook dedupes duplicate messages.
- locked-wallet push queues safe metadata only.
- trade timeline reaches mocked settled/refunded/failed states.

## Visual Verification

Run desktop and mobile checks when UI changes:

- orderbook table readable on desktop;
- order ticket usable on mobile;
- no text overlaps;
- disabled/blocked pairs are clear;
- trade status chips fit;
- no secret values shown by default.

Use Playwright/screenshots if the repo already has a browser test setup. If not,
run the app manually and report viewports checked.

## Commands To Run

Run from `webycash/weby-wallet-pwa`:

```bash
npm run check
npm run build
cargo test --manifest-path crates/wallet-wasm/Cargo.toml
```

If the extro-node integration is not available yet, use the mocked adapter and
state clearly what remains blocked.

## Deliverables

Return:

- files changed;
- module routes/components added;
- adapter mode used: mock, local WASM, or cross-domain;
- test commands and results;
- screenshots or viewport verification notes;
- integration blockers for extro-node/referee.

## Do Not Do

- Do not implement the Cloudflare referee here.
- Do not implement generic Extro wire types here.
- Do not store decrypted bearer secrets in UI state.
- Do not describe bearer flows as strictly atomic.
