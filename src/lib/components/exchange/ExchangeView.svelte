<script lang="ts">
	/**
	 * Exchange — thin router over Markets · Trade · Orders · Network.
	 * Step 7: user fills against DHTX orders call Accept → runSwap boundary
	 * (not synthetic local trade ids). Settlement claims stop at named Ark gates
	 * while ark_enabled=false / ProviderMaterial Unsupported.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import {
		orderbook,
		refreshBook,
		publishOrder,
		settleTrade,
		selectTrade,
		cancelTradeAction,
		trades,
		type MarketWalk,
		type Seeder,
		type Side,
		type LimitOrder
	} from '$lib/modules/webycash-exchange';
	import { publishOrderFee } from '$lib/modules/webycash-exchange/publish';
	import { pushStatus } from '$lib/modules/webycash-exchange/push-store.svelte';
	import { discoverSeedersFromDhtx } from '$lib/modules/webycash-exchange/seeder-discovery';
	import {
		pollAcceptsForOwnOrders,
		respondToAccept,
		runMakerSwap,
		type MakerResponse
	} from '$lib/modules/webycash-exchange/maker-responder';
	import {
		acceptNetworkOrder,
		attemptAcceptAndRunSwap
	} from '$lib/modules/webycash-exchange/accept-run-swap';
	import {
		runSwapRole,
		takerRole,
		type SwapProgress
	} from '$lib/modules/webycash-exchange/ark-swap-protocol';
	import { getRuntimeConfig } from '$lib/extro/runtime-config';
	import { buildProductRunSwapInput } from '$lib/modules/webycash-exchange/build-product-run-swap-input';
	import { getExtroClient } from '$lib/extro';
	import { getSelfIdentity } from '$lib/extro/self-identity';
	import { newRequestId } from '$lib/extro/commands';
	import { extroConnection } from '$lib/extro/connection';
	import { nav } from '$lib/stores/navigation.svelte';
	import MarketsView from './MarketsView.svelte';
	import TradeView from './TradeView.svelte';
	import OrdersView from './OrdersView.svelte';
	import NetworkView from './NetworkView.svelte';

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let { isDesktop = false }: { isDesktop?: boolean } = $props();

	let seeders = $state<Seeder[]>([]);
	let banner = $state<{ text: string; kind: 'info' | 'warn' | 'error' } | null>(null);
	let busySwap = $state<string | null>(null);
	let lastGate = $state<string | null>(null);
	const view = $derived(nav.activeView);

	const flash = (text: string, kind: 'info' | 'warn' | 'error' = 'info') => {
		banner = { text, kind };
		if (kind !== 'error') setTimeout(() => (banner = null), 6000);
	};

	let selfFp = $state<string | null>(null);
	let makerResponses = $state<MakerResponse[]>([]);
	let takerProgress = $state<SwapProgress | null>(null);
	let responderError = $state<string | null>(null);
	let responderDiag = $state<string>('responder idle');
	const arkEnabled = (): boolean => {
		try {
			return getRuntimeConfig().ark_enabled;
		} catch {
			return false;
		}
	};
	const upsertMakerResponse = (r: MakerResponse) => {
		makerResponses = [r, ...makerResponses.filter((x) => x.orderId !== r.orderId)];
		if (r.gate) lastGate = r.gate;
	};
	const handledAccepts = new Set<string>();
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let polling = false;

	let selfFpError: string | null = null;
	const loadSelfFp = async () => {
		if (selfFp) return selfFp;
		try {
			selfFp = (await getSelfIdentity(getExtroClient(), 0)).fingerprintHex;
			selfFpError = null;
		} catch (e) {
			selfFpError = e instanceof Error ? e.message : String(e);
		}
		return selfFp;
	};

	const refreshSeeders = () => {
		const conn = get(extroConnection);
		const peers = conn.peers_connected || orderbook.diag?.peers_connected || 0;
		const live = [...orderbook.bids, ...orderbook.asks];
		seeders = discoverSeedersFromDhtx({
			orders: live,
			peersConnected: peers,
			selfFingerprint: selfFp ?? undefined
		});
	};

	/** Maker responder: auto-respond to Accepts on this wallet's own orders. */
	const runMakerResponder = async () => {
		const me = await loadSelfFp();
		if (!me) {
			responderDiag = `self fingerprint unavailable: ${selfFpError ?? 'unknown'}`;
			return;
		}
		const own = [...orderbook.bids, ...orderbook.asks].filter(
			(o) => o.makerFingerprint.toLowerCase() === me
		);
		responderDiag = `self ${me.slice(0, 10)}… · own live orders ${own.length} · handled ${handledAccepts.size}`;
		if (own.length === 0) return;
		const fresh = await pollAcceptsForOwnOrders(own, handledAccepts);
		for (const { order, takerFp } of fresh) {
			handledAccepts.add(`${order.id}:${takerFp}`);
			upsertMakerResponse({
				orderId: order.id,
				takerFp,
				phase: 'accept-received',
				message: 'Taker accepted your order — responding…',
				at: Date.now()
			});
			if (arkEnabled()) {
				// Long-running two-party protocol: never block the 4 s refresh loop.
				void runMakerSwap(order, takerFp, upsertMakerResponse, 0)
					.then(upsertMakerResponse)
					.catch((e) => (responderError = e instanceof Error ? e.message : String(e)));
			} else {
				const res = await respondToAccept(order, takerFp, 0);
				upsertMakerResponse(res);
			}
		}
	};

	const refreshAll = async () => {
		if (polling) return;
		polling = true;
		try {
			await loadSelfFp();
			await refreshBook();
			refreshSeeders();
			try {
				await runMakerResponder();
				responderError = null;
			} catch (e) {
				responderError = e instanceof Error ? e.message : String(e);
			}
		} finally {
			polling = false;
		}
	};

	onMount(() => {
		void refreshAll();
		pollTimer = setInterval(() => void refreshAll(), 4000);
	});
	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});

	const oppositeSide = (side: Side): Side => (side === 'buy' ? 'sell' : 'buy');

	/** Resolve a DHTX book order for a fill (never invent a local order id). */
	const orderForFill = (fill: {
		orderId: string;
		makerFingerprint: string;
		price: number;
		fillAmount: number;
		side: Side;
	}): LimitOrder | null => {
		const live = [...orderbook.bids, ...orderbook.asks];
		return (
			live.find(
				(o) =>
					o.id === fill.orderId &&
					o.makerFingerprint.toLowerCase() === fill.makerFingerprint.toLowerCase()
			) ?? null
		);
	};

	const runAcceptPath = async (order: LimitOrder, takerSide: Side) => {
		busySwap = order.id;
		lastGate = null;
		try {
			// Derive THIS node's fingerprint so Accept→await ProviderMaterial can bind.
			let takerFingerprintHex: string | undefined;
			try {
				const id = await getExtroClient().send({
					request_id: newRequestId(),
					op: { kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot: 0 } }
				});
				if (id.kind === 'Ok' && id.body.kind === 'Identity') {
					takerFingerprintHex = id.body.fingerprint_hex;
				}
			} catch {
				/* wallet may be locked; Accept path still exercises DHTX */
			}
			if (arkEnabled()) {
				const role = takerRole(order);
				const accepted = await acceptNetworkOrder(order, 0);
				takerProgress = {
					role,
					phase: 'accept-sent',
					message: `Accept sent (delivered=${accepted.delivered}); running ${role} side`
				};
				const final = await runSwapRole(role, order, order.makerFingerprint, {
					slot: 0,
					onProgress: (p) => {
						takerProgress = p;
						if (p.gate) lastGate = p.gate;
					}
				});
				takerProgress = final;
				if (final.gate) {
					lastGate = final.gate;
					flash(`Swap (${role}) stopped at named gate: ${final.gate}`, 'warn');
				} else if (final.phase === 'error') {
					flash(`Swap (${role}) failed: ${final.message}`, 'error');
				} else {
					flash(`Swap (${role}) reached ${final.phase} for ${order.id.slice(0, 8)}…`);
				}
				return;
			}
			const result = await attemptAcceptAndRunSwap({
				order: { ...order, side: order.side },
				takerFingerprintHex,
				awaitProvider: true,
				awaitProviderOpts: { timeoutMs: 45_000, intervalMs: 300 },
				buildRunSwapInput: buildProductRunSwapInput,
				onProgress: (p) => {
					if (p.gate) lastGate = p.gate;
				}
			});
			if (result.gate) {
				lastGate = result.gate;
				const hasProvider = !!result.provider?.locked_ref;
				flash(
					`Accept→runSwap stopped at named gate (reachedRunSwap=${result.reachedRunSwap}, provider=${hasProvider}): ${result.gate}`,
					'warn'
				);
				return;
			}
			flash(`Swap advanced for ${order.id.slice(0, 8)}… (${takerSide})`);
		} catch (e) {
			flash(e instanceof Error ? e.message : String(e), 'error');
		} finally {
			busySwap = null;
		}
	};

	const onLimit = async (a: { side: Side; price: number; amount: number; expiry: number }) => {
		// Limit against the book: take the best opposite DHTX order if present.
		const bookSide = a.side === 'buy' ? orderbook.asks : orderbook.bids;
		const target = bookSide.find((o) => o.source === 'dhtx' || o.source === 'peer');
		if (!target) {
			flash(
				'No DHTX order to Accept. Publish/discover a network order first — local preview ids are disabled.',
				'warn'
			);
			return;
		}
		await runAcceptPath(target, a.side);
	};

	const onMarket = async (a: { side: Side; walk: MarketWalk }) => {
		if (a.walk.fills.length === 0) {
			flash('No fills available for this market order.', 'warn');
			return;
		}
		for (const f of a.walk.fills) {
			const order = orderForFill(f);
			if (!order) {
				flash(`Fill ${f.orderId.slice(0, 8)}… missing from DHTX book — skipped.`, 'warn');
				continue;
			}
			await runAcceptPath(order, a.side);
		}
	};

	const onPublish = async (a: { side: Side; price: number; amount: number }) => {
		await loadSelfFp();
		refreshSeeders();
		const orderValue = Math.round(a.price * a.amount);
		const pubArgs = {
			slot: 0,
			side: a.side,
			priceAtomic: BigInt(Math.max(0, Math.trunc(a.price))),
			amountAtomic: BigInt(Math.max(0, Math.trunc(a.amount))),
			expiresAt: Math.floor(Date.now() / 1000) + 3600
		};
		if (seeders.length === 0) {
			// First maker on an empty book: self-seed (no other seeder to pay).
			// The node holds the order and pushes it to every peer that connects.
			const pub = await publishOrder(pubArgs);
			if (pub.ok) {
				flash(`Order published to ${pub.peersBroadcast} peer(s) — self-seeded (first maker, no fee).`);
				refreshSeeders();
			} else flash(`Order broadcast failed: ${pub.error}`, 'error');
			return;
		}
		const res = await publishOrderFee(getExtroClient(), { orderValue, seeders, slot: 0 });
		if (!res.ok) {
			if (res.reason === 'no-active-seeders')
				flash('Publishing blocked: no active DHTX seeders (connect a peer / refresh book).', 'error');
			else if (res.reason === 'unsupported-fee-rail')
				flash('Publishing blocked: unsupported fee rail.', 'error');
			else flash('Publishing failed during fee payment.', 'error');
			return;
		}
		const pub = await publishOrder(pubArgs);
		if (pub.ok) {
			flash(
				`Order published to ${pub.peersBroadcast} peer(s) — fee paid to ${res.shares.length} seeder(s).`
			);
			refreshSeeders();
		} else flash(`Fee paid, but order broadcast failed: ${pub.error}`, 'error');
	};

	/**
	 * Advance via referee only for trades that already have a real runner /
	 * referee swap id. Local synthetic ids must not pretend to settle.
	 */
	const onSettle = async (id: string) => {
		busySwap = id;
		lastGate = null;
		try {
			const trade = trades.all.find((t) => t.swapId === id);
			const live = [...orderbook.bids, ...orderbook.asks].find((o) => o.id === id);
			if (live && (live.source === 'dhtx' || live.source === 'peer')) {
				await runAcceptPath(live, oppositeSide(live.side));
				return;
			}
			if (trade && trade.timeline.some((e) => /referee|initiate|runSwap|prove/i.test(e.note))) {
				await settleTrade(id);
				return;
			}
			// No DHTX order and no referee-backed trade: hit runSwap boundary, stop named.
			const { attemptRunSwapBoundary } = await import(
				'$lib/modules/webycash-exchange/accept-run-swap'
			);
			const result = await attemptRunSwapBoundary(undefined, id);
			if (result.gate) {
				lastGate = result.gate;
				flash(
					`Advance stopped at named gate (reachedRunSwap=${result.reachedRunSwap}): ${result.gate}`,
					'warn'
				);
			}
		} finally {
			busySwap = null;
		}
	};
	const onCancel = (id: string) => cancelTradeAction(id);
	const onSelectTrade = (id: string | null) => selectTrade(id);
</script>

<div class="animate-fade-in space-y-4" data-testid="exchange-view">
	{#if banner}
		<div
			data-testid="exchange-banner"
			class="rounded-xl px-3 py-2 text-[12px] {banner.kind === 'error'
				? 'bg-destructive/10 text-destructive'
				: banner.kind === 'warn'
					? 'bg-warning/10 text-warning'
					: 'bg-primary/8 text-primary'}">
			{banner.text}
		</div>
	{/if}

	{#if lastGate}
		<div
			data-testid="named-ark-gate"
			class="rounded-xl bg-warning/10 px-3 py-2 text-[11px] text-warning font-mono break-all">
			{lastGate}
		</div>
	{/if}

	{#if takerProgress}
		<div
			data-testid="swap-progress"
			data-role={takerProgress.role}
			data-phase={takerProgress.phase}
			class="rounded-xl bg-muted/30 px-3 py-2 text-[11px] font-mono break-all">
			{takerProgress.role} · {takerProgress.phase} · {takerProgress.message}{takerProgress.contractAddress
				? ` · contract ${takerProgress.contractAddress}`
				: ''}{takerProgress.arkAmountSats ? ` · ${takerProgress.arkAmountSats} sat` : ''}
		</div>
	{/if}

	<div data-testid="maker-responder-diag" class="sr-only">{responderDiag}</div>

	{#if responderError}
		<div data-testid="maker-responder-error" class="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive font-mono break-all">
			maker responder: {responderError}
		</div>
	{/if}

	{#if makerResponses.length > 0}
		<div data-testid="maker-responder" class="rounded-xl bg-muted/30 px-3 py-2 text-[11px] space-y-1">
			<div class="font-semibold text-[12px]">Your orders — taker activity</div>
			{#each makerResponses as r (r.orderId)}
				<div data-testid="maker-response" data-phase={r.phase} data-role={r.role ?? ''} class="font-mono break-all">
					{r.orderId.slice(0, 8)}… ← taker {r.takerFp.slice(0, 10)}… · {r.phase}{r.providerPubkey
						? ` · provider key ${r.providerPubkey.slice(0, 12)}…`
						: ''} · {r.message}
				</div>
			{/each}
		</div>
	{/if}

	{#if pushStatus.queuedCount > 0}
		<div class="rounded-xl bg-warning/10 px-3 py-2 text-[12px] text-warning flex items-center justify-between">
			<span>{pushStatus.queuedCount} settlement hook{pushStatus.queuedCount === 1 ? '' : 's'} queued (wallet was locked).</span>
			{#if pushStatus.queuedAgeSec > 120}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold">action needed</span>
			{/if}
		</div>
	{/if}

	{#if view === 'markets'}
		<MarketsView />
	{:else if view === 'trade'}
		<TradeView {seeders} {onLimit} {onMarket} {onPublish} />
	{:else if view === 'orders'}
		<OrdersView {onSettle} {onCancel} {onSelectTrade} {busySwap} />
	{:else if view === 'network'}
		<NetworkView onRefresh={() => refreshAll()} />
	{:else}
		<MarketsView />
	{/if}
</div>
