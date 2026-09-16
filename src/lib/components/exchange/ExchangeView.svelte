<script lang="ts">
	/**
	 * Exchange — thin router over Markets · Trade · Orders · Network.
	 * Step 7: user fills against DHTX orders call Accept → runSwap boundary
	 * (not synthetic local trade ids). Settlement claims stop at named Ark gates
	 * while ark_enabled=false / ProviderMaterial Unsupported.
	 */
	import { onMount } from 'svelte';
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
	import { attemptAcceptAndRunSwap } from '$lib/modules/webycash-exchange/accept-run-swap';
	import { getExtroClient } from '$lib/extro';
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

	const refreshSeeders = () => {
		const conn = get(extroConnection);
		const peers = conn.peers_connected || orderbook.diag?.peers_connected || 0;
		const live = [...orderbook.bids, ...orderbook.asks];
		seeders = discoverSeedersFromDhtx({ orders: live, peersConnected: peers });
	};

	const refreshAll = async () => {
		await refreshBook();
		refreshSeeders();
	};

	onMount(() => {
		void refreshAll();
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
			const result = await attemptAcceptAndRunSwap({
				order: { ...order, side: order.side },
				onProgress: (p) => {
					if (p.gate) lastGate = p.gate;
				}
			});
			if (result.gate) {
				lastGate = result.gate;
				flash(
					`Accept→runSwap stopped at named gate (reachedRunSwap=${result.reachedRunSwap}): ${result.gate}`,
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
		refreshSeeders();
		const orderValue = Math.round(a.price * a.amount);
		const res = await publishOrderFee(getExtroClient(), { orderValue, seeders, slot: 0 });
		if (!res.ok) {
			if (res.reason === 'no-active-seeders')
				flash('Publishing blocked: no active DHTX seeders (connect a peer / refresh book).', 'error');
			else if (res.reason === 'unsupported-fee-rail')
				flash('Publishing blocked: unsupported fee rail.', 'error');
			else flash('Publishing failed during fee payment.', 'error');
			return;
		}
		const pub = await publishOrder({
			slot: 0,
			side: a.side,
			priceAtomic: BigInt(Math.max(0, Math.trunc(a.price))),
			amountAtomic: BigInt(Math.max(0, Math.trunc(a.amount))),
			expiresAt: Math.floor(Date.now() / 1000) + 3600
		});
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
