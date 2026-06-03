<script lang="ts">
	import { onMount } from 'svelte';
	import {
		orderbook,
		selectPair,
		refreshBook,
		openTrade,
		settleTrade,
		selectTrade,
		cancelTradeAction,
		trades,
		mockSeeders,
		evaluatePair,
		type MarketWalk,
		type Seeder,
		type Side,
		type TradingPair
	} from '$lib/modules/webycash-exchange';
	import { getExtroClient, getExtroMode } from '$lib/extro';
	import { publishOrderFee } from '$lib/modules/webycash-exchange/publish';
	import { pushStatus } from '$lib/modules/webycash-exchange/push-store.svelte';
	import PairSelector from './PairSelector.svelte';
	import OrderBook from './OrderBook.svelte';
	import OrderTicket from './OrderTicket.svelte';
	import RefereeTimeline from './RefereeTimeline.svelte';
	import TradeStatus from './TradeStatus.svelte';

	let { isDesktop = false }: { isDesktop?: boolean } = $props();

	// Mocked active seeders for the publication-fee preview/flow. Real seeder
	// discovery from the torrent swarm is deferred.
	let seeders = $state<Seeder[]>(mockSeeders(3));
	let banner = $state<{ text: string; kind: 'info' | 'warn' | 'error' } | null>(null);
	let busySwap = $state<string | null>(null);

	const randHex = (n: number) => {
		const b = new Uint8Array(n);
		crypto.getRandomValues(b);
		return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
	};

	const flash = (text: string, kind: 'info' | 'warn' | 'error' = 'info') => {
		banner = { text, kind };
		if (kind !== 'error') setTimeout(() => (banner = null), 5000);
	};

	onMount(() => {
		void refreshBook();
	});

	const handleSelectPair = (p: TradingPair) => selectPair(p);

	const verdictFor = (p: TradingPair) => evaluatePair(p.base, p.quote);

	const openMediatedTrade = (side: Side, price: number, amount: number) => {
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

	const handleLimit = (args: { side: Side; price: number; amount: number; expiry: number }) => {
		const t = openMediatedTrade(args.side, args.price, args.amount);
		if (t) flash(`Limit ${args.side} opened — ${t.swapId.slice(0, 8)}…`);
	};

	const handleMarket = (args: { side: Side; walk: MarketWalk }) => {
		if (args.walk.fills.length === 0) {
			flash('No fills available for this market order.', 'warn');
			return;
		}
		// One trade timeline per fill (per the dev-plan market-order flow).
		const avgPrice =
			args.walk.filledAmount > 0 ? args.walk.totalQuote / args.walk.filledAmount : 0;
		for (const fill of args.walk.fills) {
			openMediatedTrade(args.side, fill.price, fill.fillAmount);
		}
		flash(
			`Market ${args.side}: ${args.walk.fills.length} fill(s), ` +
				`${args.walk.filledAmount} filled @ ~${avgPrice.toFixed(2)}` +
				(args.walk.remainingAmount > 0 ? ` (${args.walk.remainingAmount} unfilled)` : '')
		);
	};

	const handlePublish = async (args: { side: Side; price: number; amount: number }) => {
		const orderValue = Math.round(args.price * args.amount);
		const res = await publishOrderFee(getExtroClient(), { orderValue, seeders, slot: 0 });
		if (res.ok) {
			flash(`Order published — fee paid to ${res.shares.length} seeder(s).`);
		} else if (res.reason === 'no-active-seeders') {
			flash('Publishing blocked: no active seeders.', 'error');
		} else if (res.reason === 'unsupported-fee-rail') {
			flash('Publishing blocked: a seeder requested an unsupported fee rail.', 'error');
		} else {
			flash('Publishing failed during fee payment.', 'error');
		}
	};

	const handleSettle = async (swapId: string) => {
		busySwap = swapId;
		try {
			await settleTrade(swapId);
		} finally {
			busySwap = null;
		}
	};

	const handleCancel = (swapId: string) => cancelTradeAction(swapId);

	// Toggle mocked seeder count to exercise the 0/1/n fee states in dev.
	const setSeederCount = (n: number) => (seeders = n === 0 ? [] : mockSeeders(n));
</script>

<div class="animate-fade-in space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-[17px] font-semibold">Exchange</h2>
		<span class="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground" title="extro facade adapter mode">
			{getExtroMode()} node
		</span>
	</div>

	{#if banner}
		<div class="rounded-xl px-3 py-2 text-[12px]
			{banner.kind === 'error' ? 'bg-destructive/10 text-destructive' : banner.kind === 'warn' ? 'bg-warning/10 text-warning' : 'bg-primary/8 text-primary'}">
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

	<PairSelector pairs={orderbook.pairs} selected={orderbook.pair} onSelect={handleSelectPair} />

	<div class="grid gap-4 {isDesktop ? 'grid-cols-2' : 'grid-cols-1'}">
		<OrderBook
			pair={orderbook.pair}
			bids={orderbook.bids}
			asks={orderbook.asks}
			spread={orderbook.spread}
			midPrice={orderbook.midPrice}
			loading={orderbook.loading}
			error={orderbook.error}
			isEmpty={orderbook.isEmpty}
			lastUpdated={orderbook.lastUpdated}
			source={orderbook.source}
			onRefresh={() => refreshBook()} />

		<OrderTicket
			pair={orderbook.pair}
			verdict={orderbook.verdict}
			{seeders}
			onPlaceLimit={handleLimit}
			onPlaceMarket={handleMarket}
			onPublish={handlePublish} />
	</div>

	<!-- Dev seeder control (exercises 0/1/n publication-fee states) -->
	<div class="flex items-center gap-2 text-[11px] text-muted-foreground">
		<span>Mock seeders:</span>
		{#each [0, 1, 2, 10] as n}
			<button
				onclick={() => setSeederCount(n)}
				class="px-2 py-0.5 rounded-full transition-colors {seeders.filter((s) => s.active).length === n ? 'bg-primary/10 text-primary' : 'bg-muted/40 hover:bg-muted/60'}"
				>{n}</button>
		{/each}
	</div>

	<!-- Active + recent trades -->
	{#if trades.all.length > 0}
		<div class="space-y-2">
			<h3 class="text-[13px] font-semibold text-muted-foreground">Trades</h3>
			<div class="space-y-2">
				{#each trades.all as t (t.swapId)}
					<button
						onclick={() => selectTrade(trades.selected?.swapId === t.swapId ? null : t.swapId)}
						class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors text-left">
						<span class="text-[12px] font-mono text-muted-foreground">{t.swapId.slice(0, 10)}…</span>
						<TradeStatus phase={t.phase} />
					</button>
					{#if trades.selected?.swapId === t.swapId}
						<RefereeTimeline
							trade={t}
							onSettle={handleSettle}
							onCancel={handleCancel}
							busy={busySwap === t.swapId} />
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>
