<script lang="ts">
	/** Orders — published orders + active trades, each expandable to its referee
	 * timeline. Reuses the existing TradeStatus + RefereeTimeline untouched. */
	import { trades } from '$lib/modules/webycash-exchange';
	import RefereeTimeline from './RefereeTimeline.svelte';
	import TradeStatus from './TradeStatus.svelte';

	let {
		onSettle,
		onCancel,
		onSelectTrade,
		busySwap
	}: {
		onSettle: (id: string) => void;
		onCancel: (id: string) => void;
		onSelectTrade: (id: string | null) => void;
		busySwap: string | null;
	} = $props();
</script>

<div class="space-y-2">
	<h2 class="text-[17px] font-semibold px-1">Orders</h2>
	{#if trades.all.length === 0}
		<div class="rounded-2xl bg-muted/20 px-4 py-10 text-center text-[13px] text-muted-foreground">
			No orders or trades yet. Open one from a market.
		</div>
	{:else}
		{#each trades.all as t (t.swapId)}
			<button
				onclick={() => onSelectTrade(trades.selected?.swapId === t.swapId ? null : t.swapId)}
				class="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-muted/20 hover:bg-muted/30 transition-colors text-left">
				<span class="text-[12px] font-mono text-muted-foreground">{t.swapId.slice(0, 10)}…</span>
				<TradeStatus phase={t.phase} />
			</button>
			{#if trades.selected?.swapId === t.swapId}
				<RefereeTimeline trade={t} {onSettle} {onCancel} busy={busySwap === t.swapId} />
			{/if}
		{/each}
	{/if}
</div>
