<script lang="ts">
	/**
	 * Exchange — a thin router over the four exchange views (`nav.activeView`):
	 * Markets · Trade · Orders · Network. It owns only the cross-view trade-action
	 * state + handlers (which need component state) and passes them down; the
	 * orderbook/trade DATA lives in the module stores (persists across views). All
	 * settlement logic is reused untouched from the module — this is presentation.
	 */
	import { onMount } from 'svelte';
	import {
		orderbook,
		refreshBook,
		publishOrder,
		openTrade,
		settleTrade,
		selectTrade,
		cancelTradeAction,
		trades,
		type MarketWalk,
		type Seeder,
		type Side
	} from '$lib/modules/webycash-exchange';
	import { publishOrderFee } from '$lib/modules/webycash-exchange/publish';
	import { pushStatus } from '$lib/modules/webycash-exchange/push-store.svelte';
	import { getExtroClient } from '$lib/extro';
	import { nav } from '$lib/stores/navigation.svelte';
	import MarketsView from './MarketsView.svelte';
	import TradeView from './TradeView.svelte';
	import OrdersView from './OrdersView.svelte';
	import NetworkView from './NetworkView.svelte';

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let { isDesktop = false }: { isDesktop?: boolean } = $props();

	// Real seeders are the DHTX peers that relay the order; until peer-level
	// seeder discovery lands there are none (honest — no fabricated seeders).
	let seeders = $state<Seeder[]>([]);
	let banner = $state<{ text: string; kind: 'info' | 'warn' | 'error' } | null>(null);
	let busySwap = $state<string | null>(null);
	const view = $derived(nav.activeView);

	const randHex = (n: number) => {
		const b = new Uint8Array(n);
		crypto.getRandomValues(b);
		return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
	};
	const flash = (text: string, kind: 'info' | 'warn' | 'error' = 'info') => {
		banner = { text, kind };
		if (kind !== 'error') setTimeout(() => (banner = null), 5000);
	};

	// Fetch the book once; views switch without re-fetching (data is in the store).
	onMount(() => {
		if (!orderbook.lastUpdated) void refreshBook();
	});

	const openMediated = (side: Side, price: number, amount: number) => {
		const v = orderbook.verdict;
		if (!v.allowed) {
			flash(`Pair blocked: ${v.label}`, 'error');
			return null;
		}
		return openTrade({
			swapId: randHex(16),
			pair: orderbook.pair,
			side,
			amount,
			price,
			settlementModel: v.settlementModel,
			requiresReferee: v.requiresReferee
		});
	};

	const onLimit = (a: { side: Side; price: number; amount: number; expiry: number }) => {
		const t = openMediated(a.side, a.price, a.amount);
		if (t) flash(`Limit ${a.side} opened — ${t.swapId.slice(0, 8)}…`);
	};
	const onMarket = (a: { side: Side; walk: MarketWalk }) => {
		if (a.walk.fills.length === 0) {
			flash('No fills available for this market order.', 'warn');
			return;
		}
		for (const f of a.walk.fills) openMediated(a.side, f.price, f.fillAmount);
		const avg = a.walk.filledAmount > 0 ? a.walk.totalQuote / a.walk.filledAmount : 0;
		flash(
			`Market ${a.side}: ${a.walk.fills.length} fill(s), ${a.walk.filledAmount} @ ~${avg.toFixed(2)}` +
				(a.walk.remainingAmount > 0 ? ` (${a.walk.remainingAmount} unfilled)` : '')
		);
	};
	const onPublish = async (a: { side: Side; price: number; amount: number }) => {
		const orderValue = Math.round(a.price * a.amount);
		// Leg 1: pay the 0.1% publication (seeder) fee over an allowed rail.
		const res = await publishOrderFee(getExtroClient(), { orderValue, seeders, slot: 0 });
		if (!res.ok) {
			if (res.reason === 'no-active-seeders') flash('Publishing blocked: no active seeders.', 'error');
			else if (res.reason === 'unsupported-fee-rail') flash('Publishing blocked: unsupported fee rail.', 'error');
			else flash('Publishing failed during fee payment.', 'error');
			return;
		}
		// Leg 2: sign + broadcast the signed limit order into the node network over
		// DHTX (the WASM signs inside the wallet; the key never crosses JS). A
		// connected peer's recv-loop verifies + records it; their FetchOrders then
		// returns it with `source: 'dhtx'`.
		const pub = await publishOrder({
			slot: 0,
			side: a.side,
			priceAtomic: BigInt(Math.max(0, Math.trunc(a.price))),
			amountAtomic: BigInt(Math.max(0, Math.trunc(a.amount))),
			expiresAt: Math.floor(Date.now() / 1000) + 3600
		});
		if (pub.ok)
			flash(
				`Order published to ${pub.peersBroadcast} peer(s) — fee paid to ${res.shares.length} seeder(s).`
			);
		else flash(`Fee paid, but order broadcast failed: ${pub.error}`, 'error');
	};
	const onSettle = async (id: string) => {
		busySwap = id;
		try {
			await settleTrade(id);
		} finally {
			busySwap = null;
		}
	};
	const onCancel = (id: string) => cancelTradeAction(id);
	const onSelectTrade = (id: string | null) => selectTrade(id);
</script>

<div class="animate-fade-in space-y-4">
	{#if banner}
		<div
			class="rounded-xl px-3 py-2 text-[12px] {banner.kind === 'error'
				? 'bg-destructive/10 text-destructive'
				: banner.kind === 'warn'
					? 'bg-warning/10 text-warning'
					: 'bg-primary/8 text-primary'}">
			{banner.text}
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
		<NetworkView onRefresh={() => refreshBook()} />
	{:else}
		<MarketsView />
	{/if}
</div>
