<script lang="ts">
	/** Markets — the observed pairs, each shown explicitly (never lumped), with a
	 * hairline sparkline and a settlement chip. Tap an allowed market to trade. */
	import { orderbook, selectPair, evaluatePair, type TradingPair } from '$lib/modules/webycash-exchange';
	import { selectView } from '$lib/stores/navigation.svelte';
	import { pairLabel, pairKey } from '$lib/modules/webycash-exchange/view-data';
	import { candles as marketCandles } from '$lib/modules/webycash-exchange/market-data';

	const open = (p: TradingPair) => {
		selectPair(p);
		selectView('trade');
	};

	// Real sparkline from the observed-book candle series; null until there's
	// enough history (the sparkline is simply hidden — never faked).
	const spark = (p: TradingPair): string | null => {
		void orderbook.lastUpdated;
		const cs = marketCandles(p, 900, 24).map((c) => c.c);
		if (cs.length < 2) return null;
		const lo = Math.min(...cs);
		const hi = Math.max(...cs);
		const W = 64;
		const H = 20;
		return cs
			.map((c, i) => `${((i / (cs.length - 1)) * W).toFixed(1)},${(H - (hi > lo ? (c - lo) / (hi - lo) : 0.5) * H).toFixed(1)}`)
			.join(' ');
	};
</script>

<div class="space-y-4">
	<h2 class="text-xl font-semibold tracking-tight px-0.5">Markets</h2>
	<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
		{#each orderbook.pairs as p (pairKey(p))}
			{@const v = evaluatePair(p.base, p.quote)}
			<button
				onclick={() => v.allowed && open(p)}
				disabled={!v.allowed}
				class="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl transition-all duration-200
					{v.allowed ? 'bg-muted/30 hover:bg-muted/50 active:scale-[0.99]' : 'bg-muted/20 opacity-60 cursor-not-allowed'}
					{pairKey(orderbook.pair) === pairKey(p) ? 'ring-1 ring-primary/30' : ''}">
				<span class="text-[15px] font-medium text-left">{pairLabel(p)}</span>
				<span class="flex items-center gap-3">
					{#if v.allowed}
						{@const sp = spark(p)}
						{#if sp}
							<svg viewBox="0 0 64 20" class="w-16 h-5 hidden sm:block" preserveAspectRatio="none" aria-hidden="true">
								<polyline points={sp} fill="none" stroke="hsl(var(--primary))" stroke-width="1.5" opacity="0.8" />
							</svg>
						{/if}
						<span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium whitespace-nowrap">
							{v.requiresReferee ? 'Referee' : 'Direct'}
						</span>
					{:else}
						<span class="text-[10px] px-2 py-0.5 rounded-full bg-destructive/12 text-destructive font-medium">Blocked</span>
					{/if}
				</span>
			</button>
		{/each}
	</div>
	<p class="text-[11px] text-muted-foreground/70 px-1 pt-1">
		Pairs are observed from the extro orderbook torrent. Tap an allowed market to trade.
	</p>
</div>
