// END-TO-END exchange proof — TWO REAL BROWSER NODES, ZERO MOCKS.
//
// This is the harness the user demanded: "the testing should be e2e not
// mocking." It proves the REAL product flow — two independent browser nodes,
// each booting the real wasm extro-node with its own wallet/identity, that
// WebRTC-connect, store the orderbook ON THE NODES via DHTX, and run
// publish → discover → match → settle over the real rail with a real referee
// audit chain. NOTHING in the path may be a mock: no MockExtroAdapter, no
// mockBook(), no out-of-band order paste. The no-mock guard enforces this.
//
// STEP STATUS (see e2e/README.md for the full rationale):
//   (a) boot two real nodes ............................... LIVE
//   (guard) no mock in the path .......................... LIVE
//   (b) A↔B WebRTC DataChannel via rendezvous ............ FIXME — pending DHTX/peer-connect
//   (c) A publishes a signed LimitOrder onto the network . FIXME — no Orderbook publish wire op yet
//   (d) order replicates over DHTX, B DISCOVERS it ....... FIXME — orderbook-store still loads mockBook()
//   (e) B matches the discovered order ................... FIXME — depends on (d)
//   (f) swap SETTLES over the real rail, audit init→settled  FIXME — real code exists; gated on (c)–(e)
//
// The FIXME steps are written as REAL assertions (no mock stand-ins) and marked
// test.fixme with an explicit "UNSKIP WHEN DHTX LANDS" note. They are NOT
// deleted and NOT mocked around. When the DHTX + peer-connect work lands, the
// manager removes the `.fixme` and the chain passes for real or fails honestly.

import { test, expect } from '@playwright/test';
import {
	bootRealNode,
	assertRealNode,
	closeNode,
	probeIdentity,
	MOCK_REFEREE_PUBKEY_HEX,
	type RealNode
} from './fixtures/real-node';

// Two real nodes, shared across the ordered chain. Each is an isolated
// BrowserContext + page that has booted the real wasm node.
let nodeA: RealNode;
let nodeB: RealNode;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
	nodeA = await bootRealNode(browser, 'A');
	nodeB = await bootRealNode(browser, 'B');
});

test.afterAll(async () => {
	if (nodeA) await closeNode(nodeA);
	if (nodeB) await closeNode(nodeB);
});

// ── (a) Two real nodes boot with real, distinct identities ──────────────────
// LIVE. Proves the real wasm node is in the path on BOTH nodes (adapter mode
// 'bundled' + non-mock fingerprint) and that A and B are independent identities
// — not one shared/mock node masquerading as two.
test('(a) A and B each boot a real wasm node with distinct identities', async () => {
	const idA = await assertRealNode(nodeA);
	const idB = await assertRealNode(nodeB);

	expect(
		idA.fingerprintHex,
		'Node A and Node B derived the SAME identity — they are not two independent ' +
			'real nodes (shared state or a single mock node). The e2e premise requires two.'
	).not.toBe(idB.fingerprintHex);
});

// ── (guard) No mock anywhere in the path ────────────────────────────────────
// LIVE. Standalone guard test so a regression to the mock adapter localizes
// here. Re-probes both nodes' adapter mode + identity. (Note: we deliberately do
// NOT assert orderbook.source !== 'mock' here — refreshBook() hardcodes
// source:'mock' until DHTX lands, so that assertion belongs inside step (d), not
// the always-on guard.)
test('(guard) neither node uses a mock adapter', async () => {
	for (const node of [nodeA, nodeB]) {
		const id = await probeIdentity(node);
		expect(id.mode, `[node ${node.name}] mode must be 'bundled'`).toBe('bundled');
		expect(id.mode, `[node ${node.name}] mode must never be 'mock'`).not.toBe('mock');
	}
});

// ── (b) A and B WebRTC-connect via the rendezvous (DataChannel open) ─────────
// LIVE (DHTX landed). Each node Bootstraps via the WebRTC rendezvous; the real
// proof is that B discovers A in its roster and a peer DataChannel forms. The
// `Bootstrapped` body now carries `peers_connected` (emitted by the wasm; the
// codec passes it through even though commands.ts has not declared it yet).
//
// Ordering is load-bearing: A must register its rendezvous offer FIRST so that
// when B bootstraps, the keyserver forwards A in B's roster and B can connect to
// it. There is no auto-reannounce to late joiners, so the peer link must exist
// before A publishes (step c).
// The running default (non-dynamo) keyserver is booted (EXTRO_OPERATOR_* env)
// with a fixed dev operator identity. Bootstrap is FAIL-CLOSED (no TOFU): it
// requires the key-server `(fingerprint, vk)` to be PINNED out-of-band first
// (extro-node keyserver/bootstrap.rs: "no pinned key-server anchor"). These are
// the real anchor values for the local stack:
//   fingerprint  EXTRO_OPERATOR_FINGERPRINT = 00112233445566778899aabbccddeeff00112233
//   domain       EXTRO_OPERATOR_DOMAIN      = keyserver.local
//   vk           Ed25519 pubkey of EXTRO_OPERATOR_DEV_KEY seed 0x11*32
//                = d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737
// Pinning through the app's own Keyserver::Pin command is the real anchoring
// path — not faked state. If the vk/fingerprint were wrong, Bootstrap's
// fail-closed verify would reject ("fingerprint mismatch against pinned anchor").
const KS_DOMAIN = 'keyserver.local';
const KS_FINGERPRINT_HEX = '00112233445566778899aabbccddeeff00112233';
const KS_VK_HEX = 'd04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737';

const pinKeyserver = async (node: RealNode) =>
	node.page.evaluate(
		async ({ domain, fingerprintHex, vkHex }) => {
			const client = (window as unknown as { __extro: any }).__extro;
			const { newRequestId } = await import('/src/lib/extro/commands.ts');
			const { KEYSERVER_URL } = await import('/src/lib/extro/config.ts');
			const res = await client.send({
				request_id: newRequestId(),
				op: {
					kind: 'Keyserver',
					cmd: {
						op: 'Pin',
						base_url: KEYSERVER_URL,
						domain,
						fingerprint_hex: fingerprintHex,
						vk_hex: vkHex
					}
				}
			});
			return res?.kind === 'Ok'
				? { ok: true as const, body: res.body?.kind }
				: { ok: false as const, err: res?.kind === 'Err' ? `${res.code}: ${res.message}` : `unexpected ${res?.kind}` };
		},
		{ domain: KS_DOMAIN, fingerprintHex: KS_FINGERPRINT_HEX, vkHex: KS_VK_HEX }
	);

const bootstrap = async (node: RealNode) =>
	node.page.evaluate(async (domain) => {
		const client = (window as unknown as { __extro: any }).__extro;
		const { newRequestId } = await import('/src/lib/extro/commands.ts');
		const { KEYSERVER_URL } = await import('/src/lib/extro/config.ts');
		const res = await client.send({
			request_id: newRequestId(),
			op: {
				kind: 'Keyserver',
				cmd: { op: 'Bootstrap', base_url: KEYSERVER_URL, domain }
			}
		});
		if (res?.kind === 'Ok' && res.body?.kind === 'Bootstrapped') {
			return {
				ok: true,
				connected: res.body.connected,
				roster: res.body.roster_count,
				peersConnected: res.body.peers_connected ?? null,
				dhtxSeeds: res.body.dhtx_seeds_count
			};
		}
		return {
			ok: false,
			connected: false,
			roster: 0,
			peersConnected: null,
			dhtxSeeds: 0,
			err: res?.kind === 'Err' ? `${res.code}: ${res.message}` : `unexpected body ${res?.body?.kind}`
		};
	}, KS_DOMAIN);

test('(b) A and B establish a real WebRTC DataChannel via the rendezvous', async () => {
	// Pin the key-server anchor on BOTH nodes (fail-closed bootstrap precondition).
	const pinA = await pinKeyserver(nodeA);
	const pinB = await pinKeyserver(nodeB);
	console.log('[b] pin A:', JSON.stringify(pinA), 'pin B:', JSON.stringify(pinB));
	expect(pinA.ok, `Node A Pin failed: ${JSON.stringify(pinA)}`).toBe(true);
	expect(pinB.ok, `Node B Pin failed: ${JSON.stringify(pinB)}`).toBe(true);

	// NOTE: the local dev keyserver returns a STUB sdp_answer, so the KS
	// DataChannel `connected` stays FALSE by design (the KS is not itself a WebRTC
	// peer in the HTTPS-only build — extro-node keyserver/bootstrap.rs). The real
	// A↔B link forms over the answer-mailbox peer-connect phase, signalled by
	// `peers_connected`, NOT by `connected`. We therefore do not assert `connected`.
	//
	// TIMING: peer-connect is a synchronous phase INSIDE each bootstrap call (the
	// answerer accepts the peer's roster offer, POSTs an answer, and waits_open;
	// the offerer polls its mailbox ~15s and applies the answer). The dialer is
	// dropped when the bootstrap call returns, so BOTH nodes' peer-connect windows
	// must OVERLAP for the DataChannel to open. A first registers its stable offer
	// (so B's roster sees it), then A and B re-bootstrap CONCURRENTLY — A reuses
	// its stable offer and now sees B; B sees A; both run connect_roster_peers at
	// once and the offerer's poll catches the answerer's mailbox post.
	// BOUNDED RETRY (sanctioned by the webrtc-loopback-flake note). Headless
	// chromium loopback WebRTC is transiently flaky in two real ways observed
	// here: (1) ICE gathering occasionally stalls past 15s on a single bootstrap;
	// (2) the answer mailbox carries TTL-bounded stale offers from prior runs (the
	// dev keyserver is long-lived, record TTL 300s) so an answerer can target a
	// dead entry and burn its wait_open timeout. Both are transient races, not
	// product defects. Re-bootstrapping is the product's OWN reconnect path, so we
	// retry the full register→concurrent-connect sequence up to 5× until a peer
	// DataChannel opens. NOT mocking — every attempt is a real Pin-verified
	// bootstrap + real WebRTC ICE/DataChannel.
	let a = a0Init();
	let b = a0Init();
	function a0Init() {
		return { ok: false as boolean, connected: false, roster: 0, peersConnected: 0 as number | null, dhtxSeeds: 0 } as Awaited<ReturnType<typeof bootstrap>>;
	}
	for (let attempt = 1; attempt <= 5; attempt++) {
		// Register A's stable offer (best-effort; a transient ICE stall here is
		// retried by the outer loop rather than being fatal).
		const a0 = await bootstrap(nodeA);
		console.log(`[b] attempt ${attempt} — A register:`, JSON.stringify(a0));
		await nodeA.page.waitForTimeout(1000);
		// Concurrent peer-connect windows: A re-bootstraps (sees B) while B
		// bootstraps (sees A); both run connect_roster_peers simultaneously.
		[a, b] = await Promise.all([bootstrap(nodeA), bootstrap(nodeB)]);
		console.log(`[b] attempt ${attempt} — A:`, JSON.stringify(a), 'B:', JSON.stringify(b));
		if (a.ok && b.ok && (a.peersConnected ?? 0) + (b.peersConnected ?? 0) > 0) break;
		await nodeA.page.waitForTimeout(1500);
	}
	expect(a.ok, `Node A Bootstrap failed after retries: ${JSON.stringify(a)}`).toBe(true);
	expect(b.ok, `Node B Bootstrap failed after retries: ${JSON.stringify(b)}`).toBe(true);

	// EMPIRICAL precondition check: did each node's roster contain the other
	// WITHOUT any follow step? The default (non-dynamo) keyserver build returns an
	// all-other-peers roster (cap 100), so the peer should appear with no
	// register/follow. If both rosters are empty, a peer cannot form and the chain
	// is blocked here (reported, not mocked around).
	expect(
		a.roster + b.roster,
		`Neither node's roster contained the other after bootstrap — the rendezvous did not ` +
			`forward the peer. A peer DataChannel cannot form; the chain is blocked at peer ` +
			`formation. (A=${JSON.stringify(a)}, B=${JSON.stringify(b)})`
	).toBeGreaterThan(0);

	// The peer-connect signal: at least one side reached an Open DataChannel to the
	// other over the mailbox (the answerer's wait_open / the offerer's apply+open).
	expect(
		(a.peersConnected ?? 0) + (b.peersConnected ?? 0),
		`Each node saw the other in its roster (A.roster=${a.roster}, B.roster=${b.roster}) but ` +
			`0 peer DataChannels opened (A.peers_connected=${a.peersConnected}, ` +
			`B.peers_connected=${b.peersConnected}). The A↔B WebRTC link did not form over the ` +
			`answer mailbox — peer-formation blocker. (A=${JSON.stringify(a)}, B=${JSON.stringify(b)})`
	).toBeGreaterThan(0);
});

// Order parameters published by A and matched by B, shared across (c)–(f).
// Both nodes use the store's selected pair (default MOCK_PAIRS[0]) so the publish
// pair and the fetch pair MATCH by construction. price/amount ride as bigint
// (the codec maps u128↔bigint); expiry is well into the future so `liveOrders()`
// does not sweep the order before B fetches it.
const ORDER_PRICE_ATOMIC = 100n;
const ORDER_AMOUNT_ATOMIC = 1000n;

// ── (c) A publishes a SIGNED LimitOrder onto the node network ────────────────
// LIVE (DHTX landed). A drives the REAL product `publishOrder()` store function,
// which dispatches `Dhtx::PublishOrder` — the wallet identity key signs the order
// INSIDE the wasm, records it locally, and broadcasts an OrderAnnounce to every
// connected 1-hop peer. The returned `peersBroadcast` is the single best
// root-cause discriminator: 0 ⇒ no DataChannel formed (the order never left A);
// ≥1 ⇒ the order reached B's transport and any discovery failure is downstream.
let publishedOrderId = '';
test('(c) Node A publishes a signed LimitOrder onto the DHTX', async () => {
	const result = await nodeA.page.evaluate(
		async ({ price, amount }) => {
			const { publishOrder } = await import(
				'/src/lib/modules/webycash-exchange/orderbook-store.svelte.ts'
			);
			const expiresAt = Math.floor(Date.now() / 1000) + 3600; // +1h, well in the future
			const res = await publishOrder({
				slot: 0,
				side: 'sell',
				priceAtomic: BigInt(price),
				amountAtomic: BigInt(amount),
				expiresAt
			});
			return res;
		},
		{ price: ORDER_PRICE_ATOMIC.toString(), amount: ORDER_AMOUNT_ATOMIC.toString() }
	);
	console.log('[c] node A publishOrder:', JSON.stringify(result));

	expect(result.ok, `Node A publishOrder failed: ${JSON.stringify(result)}`).toBe(true);
	if (result.ok) {
		expect(result.orderId, 'publishOrder returned no order id').toMatch(/^[0-9a-fA-F]+$/);
		publishedOrderId = result.orderId;
		// ROOT-CAUSE DISCRIMINATOR: peers reached by the OrderAnnounce broadcast.
		// 0 ⇒ no peer DataChannel formed (peer-formation blocker). The chain cannot
		// succeed downstream, so fail HERE with that precise diagnosis.
		expect(
			result.peersBroadcast,
			`Node A's order reached 0 peers (peersBroadcast=0): no WebRTC DataChannel to Node B ` +
				`formed. This is a PEER-FORMATION blocker — the order never left A — not a discovery bug.`
		).toBeGreaterThan(0);
	}
});

// ── (d) The order replicates over DHTX and B DISCOVERS it by querying its node ─
// LIVE (DHTX landed). THE SUCCESS CRITERION. The book is stored ON THE NODES
// (DHTX); B discovers A's order by querying ITS OWN node via the real product
// `refreshBook()` (`Dhtx::FetchOrders`) — never a server, never an out-of-band
// paste. `source` must be 'dhtx', but the LOAD-BEARING assertion is the order
// COUNT: `source:'dhtx'` only proves the FetchOrders path works (it is set on any
// Ok/Orders response, even empty), so PASS keys on B actually seeing A's order.
// WebRTC ICE + broadcast drain are async, so B is polled (~30s) rather than
// single-checked.
test('(d) Node B discovers Node A\'s order over DHTX (no server, no paste)', async () => {
	// The DHTX recv is "pull-on-drain": there is NO periodic tick (deferred to v2),
	// so the OrderAnnounce frame is only recorded on B when B next issues a
	// FetchOrders that drains the inbound channel. A real client re-polls; so does
	// this assertion. We re-poll the REAL `refreshBook()` until A's order appears.
	//
	// LOAD-BEARING: we bind to A's *specific* `publishedOrderId`, not merely
	// count>0. The backend/keyserver/DHTX stack stays UP across all 10 runs and the
	// (b) note flags records persisting (TTL 300s); a residual order from a prior
	// run could make a bare count>0 pass while A's fresh order never arrived — a
	// false green. Each run's order carries a fresh expires_at (now+3600) so its id
	// is unique to this run; binding to publishedOrderId cleanly separates
	// fresh-delivery from stale-residual.
	expect(publishedOrderId, 'step (c) must have published an order before (d)').toMatch(/^[0-9a-fA-F]+$/);

	let book: {
		source: string;
		askCount: number;
		bidCount: number;
		askIds: string[];
		bidIds: string[];
		error: string | null;
	} = { source: '<none>', askCount: 0, bidCount: 0, askIds: [], bidIds: [], error: null };
	const startedAt = Date.now();
	let discoveredAtMs: number | null = null;

	// Re-poll the REAL refreshBook() until A's SPECIFIC order appears. The DHTX
	// recv is "pull-on-drain" (no periodic tick — deferred to v2), so the
	// OrderAnnounce frame is recorded on B only when B next issues a FetchOrders
	// that drains the inbound channel. A real client re-polls; so does this
	// assertion. The predicate keys on `publishedOrderId`, so a residual/other
	// order cannot satisfy it — only fresh delivery of A's order does.
	await expect
		.poll(
			async () => {
				book = await nodeB.page.evaluate(async () => {
					const { orderbook, refreshBook } = await import(
						'/src/lib/modules/webycash-exchange/orderbook-store.svelte.ts'
					);
					await refreshBook();
					return {
						source: orderbook.source,
						askCount: orderbook.asks.length,
						bidCount: orderbook.bids.length,
						askIds: orderbook.asks.map((o) => o.id),
						bidIds: orderbook.bids.map((o) => o.id),
						error: orderbook.error
					};
				});
				const found =
					book.askIds.includes(publishedOrderId) || book.bidIds.includes(publishedOrderId);
				if (found && discoveredAtMs === null) discoveredAtMs = Date.now() - startedAt;
				return found;
			},
			{
				message: `Node B never discovered Node A's published order ${publishedOrderId} over DHTX`,
				timeout: 30_000,
				intervals: [1000, 1000, 2000, 2000, 3000]
			}
		)
		.toBe(true);

	console.log(
		`[d] node B discovered A's order ${publishedOrderId} after ${discoveredAtMs}ms — book:`,
		JSON.stringify(book)
	);

	// REAL source: the book comes from the DHTX node network, never 'mock'/'paste'.
	expect(
		book.source,
		`Node B's orderbook source is '${book.source}', not 'dhtx'. For a valid e2e the book ` +
			`MUST be the real DHTX-replicated book — any mock/paste here = test invalid.`
	).toBe('dhtx');
	expect(book.source, 'Node B orderbook source must never be mock').not.toBe('mock');
	// THE load-bearing success assertion: B actually sees A's SPECIFIC published
	// order over DHTX (not just some non-empty book).
	expect(
		[...book.askIds, ...book.bidIds],
		`Node B's discovered book does not contain A's published order ${publishedOrderId}`
	).toContain(publishedOrderId);
});

// ── (e) Node B matches the discovered order ──────────────────────────────────
// REAL assertion, FIXME-pending-DHTX. Depends on (d): B must match a REAL order
// it discovered over DHTX, not a mockBook() row. The match opens a local Trade
// bound to A's real order id.
//
// UNSKIP WHEN DHTX LANDS (after (d)): match the first real discovered order.
test('(e) Node B matches the order discovered over DHTX', async () => {
	const matched = await nodeB.page.evaluate(async () => {
		const { orderbook } = await import(
			'/src/lib/modules/webycash-exchange/orderbook-store.svelte.ts'
		);
		const { openTrade } = await import('/src/lib/modules/webycash-exchange/trade-store.svelte.ts');
		const target = orderbook.asks[0] ?? orderbook.bids[0];
		if (!target) return { matched: false };
		const trade = openTrade({
			swapId: target.id,
			pair: orderbook.pair,
			side: target.side === 'sell' ? 'buy' : 'sell',
			amount: target.amount,
			price: target.price,
			settlementModel: orderbook.verdict.settlementModel,
			requiresReferee: orderbook.verdict.requiresReferee
		});
		return { matched: Boolean(trade), swapId: trade?.swapId };
	});
	expect(matched.matched, 'Node B could not match a real discovered order').toBe(true);
});

// ── (f) The swap SETTLES over the real rail with a real audit chain ──────────
// REAL assertion, FIXME-pending-DHTX. The settlement code IS real today
// (HttpRefereeClient mode 'http', swap-runner's executeSwap drives proving →
// initiate → advance → settled against the live referee + static/circuits-dev
// proving keys). It is gated here only because it must consume the order matched
// in (e). When run, it asserts a REAL referee (http mode, non-mock pubkey) and a
// real audit chain ending in a settled/completed terminal phase.
//
// UNSKIP WHEN DHTX LANDS (after (c)–(e)): point at the live referee + rail stack
// (PUBLIC_REFEREE_URL) and remove `.fixme`.
test.fixme('(f) the matched swap settles over the real rail (audit init→…→settled)', async () => {
	const result = await nodeB.page.evaluate(
		async (mockPubkey) => {
			const { HttpRefereeClient } = await import(
				'/src/lib/modules/webycash-exchange/referee-client.ts'
			);
			const { REFEREE_URL } = await import('/src/lib/extro/config.ts');
			const referee = new HttpRefereeClient({ baseUrl: REFEREE_URL });

			// REAL referee, not the mock: http transport + a real pubkey.
			const pk = await referee.pubkey();
			if (referee.mode !== 'http') return { ok: false, why: 'referee not http mode' };
			if (pk.ed25519_pubkey_hex === mockPubkey) return { ok: false, why: 'mock referee pubkey' };

			// Drive the real swap via the real runner against the matched order.
			const { executeSwap } = await import('/src/lib/modules/webycash-exchange/swap-runner.ts');
			const { orderbook } = await import(
				'/src/lib/modules/webycash-exchange/orderbook-store.svelte.ts'
			);
			const order = orderbook.asks[0] ?? orderbook.bids[0];
			// The provider material + mnemonic come from the real wallet/peer in the
			// full flow; this is the call shape the manager wires when DHTX lands.
			const res = await executeSwap({
				order,
				mnemonic: (window as unknown as { __mnemonic?: string }).__mnemonic ?? '',
				provider: (window as unknown as { __provider?: any }).__provider,
				referee
			});
			const audit = await referee.audit(res.swapId);
			return {
				ok: res.terminal && (res.phase === 'settled' || res.phase === 'completed'),
				phase: res.phase,
				auditPhases: audit.map((a) => a.phase)
			};
		},
		MOCK_REFEREE_PUBKEY_HEX
	);

	expect(result.ok, `Swap did not settle over the real rail: ${JSON.stringify(result)}`).toBe(true);
	// Real audit chain: opens at request-sent/init and ends settled.
	expect(result.auditPhases?.[0], 'Audit chain did not start at an init phase').toMatch(/init|request/i);
	expect(result.auditPhases?.[result.auditPhases.length - 1], 'Audit chain did not end settled').toMatch(
		/settled|completed/i
	);
});
