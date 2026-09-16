# Two-Real-Browser-Node Exchange Harness (e2e, ZERO mocks)

This harness proves the **real** Webycash exchange product flow end to end:
two independent browser nodes, each running the **real wasm extro-node** with
its own wallet/identity, that WebRTC-connect, store the orderbook **on the nodes
via DHTX**, and run **publish → discover → match → settle** over the **real
rail** with a **real referee audit chain**.

> **Any mock in the path makes a run INVALID.** MockExtroAdapter, `mockBook()`,
> and out-of-band order paste are all forbidden in this path. The no-mock guard
> (below) fails loudly if a mock is ever observed. A green run with a mock in
> the path is not a pass — it is a broken harness.

## The exact command the manager runs

```sh
# Prereq (operator/manager does this — the harness NEVER syncs wasm itself):
#   the real extro-node wasm artifact must already be in src/lib/node/pkg/
#   (npm run sync:wasm, run by the cargo/wasm lane — NOT by this harness).

# 1. install the Playwright runner (devDependency is declared; install once):
npm install
npx playwright install chromium

# 2. run the harness (starts vite dev on port 5183, NOT npm run dev):
npx playwright test --config playwright.config.ts
```

To target an already-running dev server (or avoid port 5183):

```sh
E2E_BASE_URL=http://localhost:5183 npx playwright test
# or pick another port:
E2E_PORT=5190 npx playwright test
```

List the tests without running them (parse check):

```sh
npx playwright test --list
```

## Artifact verification

`npm run dev` first runs `scripts/verify-wasm.mjs`. That fast pre-hook checks
the committed wallet and extro-node packages against `wasm-artifacts.json`; it
does not invoke Cargo or read a sibling checkout. Playwright uses this same
command, so a missing or stale binary fails before the browser starts.

The server runs on **port 5183** (not 5174, which a live session may hold) and
under `vite dev` so `import.meta.env.DEV` is true — required for the page to
expose `window.__extro`, the real bundled client the guard inspects. Do **not**
point the harness at `vite preview` or a static build (DEV is false there;
`window.__extro` would be absent and the harness fails at boot).

`PUBLIC_EXTRO_ADAPTER=bundled` is forced in the webServer env so the app boots
the real same-realm wasm node (`src/routes/+layout.ts`).

## How the no-mock guard works

The app publishes its authoritative `ExtroClient` on `window.__extro` (DEV-only
hook in `+layout.ts`). The harness drives **real `ExtroCommand`s** through that
client from inside the page — exercising the exact encode → wasm `extro_node_send`
→ decode seam the product uses. There are no DOM test ids on the exchange views,
so this client-level path is the assertion surface.

`assertRealNode()` / the `(guard)` test enforce no-mock on two independent axes:

1. **adapter mode is exactly `bundled`** — never `mock`. (`MockExtroAdapter.mode
   === 'mock'`; the real one is `'bundled'`.)
2. **the derived identity fingerprint is NOT the mock constant**
   `'fp'.repeat(10)` (what `MockExtroAdapter` returns for `DeriveIdentity`). Real
   wasm cryptography produces a real, distinct fingerprint — and Node A ≠ Node B,
   proving two independent real nodes rather than one shared/mock node.

For the settle step, the same idea applies to the referee: real `HttpRefereeClient`
mode is `'http'` and its pubkey must not be the mock constant `'00'.repeat(32)`.

### Wallet seeding (why it is real, not a mock)

The extro-node wasm wallet boots **locked** with an empty master wallet
(`src/lib/extro/seed.ts`): `DeriveIdentity` / `Bootstrap` fail with "wallet
locked" until an `Import { mnemonic }` command unlocks it. `bootRealNode`
therefore seeds each node with a **distinct** throwaway BIP39 test mnemonic
(`TEST_MNEMONICS.A` / `.B`) — dispatched through the authoritative
`window.__extro` client, exactly the real `Import` op the app uses on unlock.
This is real key derivation: distinct seeds → distinct real identities → the
A≠B assertion holds by construction, and neither is the mock constant. (It is
**not** done by importing `seed.ts` inside `page.evaluate`, which would resolve
a separate, mock-defaulting client singleton.)

The `orderbook.source !== 'mock'` assertion is **inside step (d)**, not the
always-on guard: `refreshBook()` currently hardcodes `source: 'mock'` (mockBook),
so a global assertion would fail the boot test for the wrong reason. Source-is-real
is exactly what step (d) proves once DHTX lands.

## What each step proves

| Step | Proves | Status |
|------|--------|--------|
| (a) | A and B each boot a **real wasm node** (mode `bundled`, non-mock fingerprint) with **distinct identities** | **LIVE** |
| (guard) | Neither node uses a mock adapter | **LIVE** |
| (b) | A↔B establish a **real WebRTC DataChannel** via the rendezvous (no relay) | FIXME — pending DHTX/peer-connect |
| (c) | A publishes a **signed LimitOrder** onto the node network (DHTX), returning a real commitment | FIXME — no Orderbook publish wire op exists yet |
| (d) | The order **replicates over DHTX** and B **discovers** it by querying **its own node** — not a server, not a paste; book `source !== 'mock'` | FIXME — orderbook-store still loads `mockBook()` |
| (e) | B **matches** the real discovered order (opens a Trade bound to A's real order id) | FIXME — depends on (d) |
| (f) | The swap **SETTLES over the real rail** with a real referee (`http` mode, non-mock pubkey) and a real audit chain `init → … → settled` | FIXME — real code exists; gated on (c)–(e) |

## Why steps (b)–(f) are `test.fixme`, not deleted and not mocked

These steps depend on network surfaces that **do not exist yet** in the codebase:

- **(b)** The Keyserver `Bootstrap` command's own doc (`src/lib/extro/commands.ts`)
  states: *"Connecting roster peers + walking the DHTX seeds is the later DHTX
  task; this brings up only the KS link."*
- **(c)** There is **no Orderbook publish wire op** in `commands.ts`. `publish.ts`
  only computes + pays the 0.1% publication fee — it does not put the order on the
  network.
- **(d)** `orderbook-store.svelte.ts` hardcodes `mockBook()` and `source: 'mock'`;
  there is no real DHTX subscription yet.
- **(e)**, **(f)** depend on a real discovered order from (c)/(d).

Each is written as a **real assertion** (no mock stand-ins) and marked
`test.fixme` with an `UNSKIP WHEN DHTX LANDS` comment in the spec. When the DHTX +
peer-connect work lands, the manager removes `.fixme` (and wires the real
Orderbook publish op / real referee+rail endpoints noted in each step) and the
chain either passes **for real** or fails **honestly**.

## Files

- `playwright.config.ts` — runner config (port 5183, `vite dev` not `npm run dev`, forced bundled adapter).
- `e2e/fixtures/real-node.ts` — boots one real browser-node, probes real identity, and the no-mock guard.
- `e2e/exchange-two-node.spec.ts` — the (a)–(f) chain, each step a distinct test.
