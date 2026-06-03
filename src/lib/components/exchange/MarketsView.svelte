<script lang="ts">
	/** Markets — the observed pairs, each shown explicitly (never lumped), with a
	 * hairline sparkline and a settlement chip. Tap an allowed market to trade. */
	import { orderbook, selectPair, evaluatePair, type TradingPair } from '$lib/modules/webycash-exchange';
	import { selectView } from '$lib/stores/navigation.svelte';
	import { pairLabel, pairKey, mockCandles } from '$lib/modules/webycash-exchange/view-data';

	const open = (p: TradingPair) => {
		selectPair(p);
		selectView('trade');
	};

	const spark = (p: TradingPair) => {
		const cs = mockCandles(p, 24).map((c) => c.c);
		const lo = Math.min(...cs);
		const hi = Math.max(...cs);
		const W = 64;
		const H = 20;
		const pts = cs
			.map((c, i) => `${((i / (cs.length - 1)) * W).toFixed(1)},${(H - (hi > lo ? (c - lo) / (hi - lo) : 0.5) * H).toFixed(1)}`)
			.join(' ');
		return pts;
	};
</script>

<div class="space-y-2">
	<h2 class="text-[17px] font-semibold px-1">Markets</h2>
	<div class="space-y-1.5">
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
						<svg viewBox="0 0 64 20" class="w-16 h-5 hidden sm:block" preserveAspectRatio="none" aria-hidden="true">
							<polyline points={spark(p)} fill="none" stroke="hsl(var(--primary))" stroke-width="1.5" opacity="0.8" />
						</svg>
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
