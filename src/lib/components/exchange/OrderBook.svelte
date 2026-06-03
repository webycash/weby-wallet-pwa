<script lang="ts">
	import type { LimitOrder, TradingPair } from '$lib/modules/webycash-exchange';
	import { assetLabel } from '$lib/modules/webycash-exchange';

	let {
		pair,
		bids,
		asks,
		spread,
		midPrice,
		loading,
		error,
		isEmpty,
		lastUpdated,
		source,
		onRefresh
	}: {
		pair: TradingPair;
		bids: LimitOrder[];
		asks: LimitOrder[];
		spread: number | null;
		midPrice: number | null;
		loading: boolean;
		error: string | null;
		isEmpty: boolean;
		lastUpdated: number | null;
		source: string;
		onRefresh: () => void;
	} = $props();

	const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
	const freshness = (sec: number | null) => {
		if (sec === null) return '—';
		const age = Math.max(0, Math.floor(Date.now() / 1000) - sec);
		if (age < 5) return 'just now';
		if (age < 60) return `${age}s ago`;
		return `${Math.floor(age / 60)}m ago`;
	};
	// Cap rows so a deep book stays readable; the depth is still in the store.
	const TOP = 8;
	const topAsks = $derived([...asks].slice(0, TOP).reverse()); // worst→best for the classic stacked view
	const topBids = $derived(bids.slice(0, TOP));
</script>

<div class="rounded-2xl bg-muted/20 overflow-hidden">
	<!-- Header: pair + freshness/source + refresh -->
	<div class="flex items-center justify-between px-4 py-3">
		<div class="flex items-center gap-2 text-[13px] font-semibold">
			<span>{assetLabel(pair.base)}</span>
			<span class="opacity-40">/</span>
			<span>{assetLabel(pair.quote)}</span>
		</div>
		<div class="flex items-center gap-2 text-[11px] text-muted-foreground">
			<span class="px-2 py-0.5 rounded-full bg-muted/50 capitalize">{source}</span>
			<span>{freshness(lastUpdated)}</span>
			<button
				onclick={onRefresh}
				class="px-2 py-0.5 rounded-full hover:bg-muted/60 transition-colors"
				aria-label="Refresh orderbook">refresh</button>
		</div>
	</div>

	{#if error}
		<div class="px-4 py-6 text-center text-[13px] text-destructive">
			Failed to load orderbook: {error}
		</div>
	{:else if loading && isEmpty}
		<div class="px-4 py-10 text-center text-[13px] text-muted-foreground animate-pulse">
			Loading orderbook…
		</div>
	{:else if isEmpty}
		<div class="px-4 py-10 text-center text-[13px] text-muted-foreground">
			No live orders for this pair yet.
		</div>
	{:else}
		<!-- Column headers -->
		<div class="grid grid-cols-3 px-4 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
			<span>Price ({assetLabel(pair.quote)})</span>
			<span class="text-right">Amount ({assetLabel(pair.base)})</span>
			<span class="text-right">Source</span>
		</div>

		<!-- Asks (sells), stacked worst→best so best ask sits next to the spread -->
		<div class="space-y-px">
			{#each topAsks as o (o.id)}
				<div class="grid grid-cols-3 px-4 py-1 text-[12px] tabular-nums">
					<span class="text-destructive">{fmt(o.price)}</span>
					<span class="text-right text-muted-foreground">{fmt(o.amount)}</span>
					<span class="text-right text-[10px] text-muted-foreground/70 capitalize">{o.source}</span>
				</div>
			{/each}
		</div>

		<!-- Spread row -->
		<div class="flex items-center justify-center gap-3 px-4 py-2 my-px bg-muted/30 text-[11px]">
			<span class="text-muted-foreground">Spread</span>
			<span class="font-semibold tabular-nums {spread !== null && spread < 0 ? 'text-destructive' : ''}">
				{spread === null ? '—' : fmt(spread)}
			</span>
			{#if midPrice !== null}
				<span class="text-muted-foreground">Mid {fmt(midPrice)}</span>
			{/if}
			{#if spread !== null && spread < 0}
				<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold">crossed</span>
			{/if}
		</div>

		<!-- Bids (buys), best first -->
		<div class="space-y-px pb-2">
			{#each topBids as o (o.id)}
				<div class="grid grid-cols-3 px-4 py-1 text-[12px] tabular-nums">
					<span class="text-success">{fmt(o.price)}</span>
					<span class="text-right text-muted-foreground">{fmt(o.amount)}</span>
					<span class="text-right text-[10px] text-muted-foreground/70 capitalize">{o.source}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
