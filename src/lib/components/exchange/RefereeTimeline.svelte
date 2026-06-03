<script lang="ts">
	import {
		assetLabel,
		isTerminal,
		type Trade
	} from '$lib/modules/webycash-exchange';
	import TradeStatus from './TradeStatus.svelte';

	let {
		trade,
		onSettle,
		onCancel,
		busy = false
	}: {
		trade: Trade;
		onSettle: (swapId: string) => void;
		onCancel: (swapId: string) => void;
		busy?: boolean;
	} = $props();

	const time = (sec: number) =>
		new Date(sec * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	const terminal = $derived(isTerminal(trade));
	const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
</script>

<div class="rounded-2xl bg-muted/20 p-4 space-y-3">
	<div class="flex items-start justify-between gap-2">
		<div>
			<div class="flex items-center gap-1.5 text-[13px] font-semibold">
				<span class="capitalize">{trade.side}</span>
				<span>{assetLabel(trade.pair.base)}</span>
				<span class="opacity-40">/</span>
				<span>{assetLabel(trade.pair.quote)}</span>
			</div>
			<div class="text-[11px] text-muted-foreground tabular-nums mt-0.5">
				{fmt(trade.amount)} @ {fmt(trade.price)}
			</div>
		</div>
		<TradeStatus phase={trade.phase} />
	</div>

	<!-- Settlement model — never claim atomicity for a bearer flow -->
	<div class="text-[11px] text-muted-foreground">
		Settlement:
		<span class="font-medium text-foreground">{trade.settlementModel}</span>
		{#if trade.requiresReferee}<span class="ml-1 px-1.5 py-0.5 rounded-full bg-warning/15 text-warning text-[9px] font-semibold">referee</span>{/if}
	</div>

	<!-- Timeline -->
	<ol class="space-y-1.5 border-l border-muted/60 pl-3.5">
		{#each trade.timeline as ev, i (i)}
			<li class="relative">
				<span class="absolute -left-[1.18rem] top-1 w-2 h-2 rounded-full {i === trade.timeline.length - 1 ? 'bg-primary' : 'bg-muted-foreground/40'}"></span>
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-[12px]">{ev.note}</span>
					<span class="text-[10px] text-muted-foreground tabular-nums shrink-0">{time(ev.at)}</span>
				</div>
			</li>
		{/each}
	</ol>

	{#if !terminal}
		<div class="grid grid-cols-2 gap-2 pt-1">
			<button
				onclick={() => onSettle(trade.swapId)}
				disabled={busy}
				class="h-10 rounded-full bg-primary text-primary-foreground text-[12px] font-medium transition-all active:scale-[0.97] hover:opacity-90 disabled:opacity-40">
				{busy ? 'Advancing…' : 'Advance via referee'}
			</button>
			<button
				onclick={() => onCancel(trade.swapId)}
				disabled={busy}
				class="h-10 rounded-full bg-muted/60 text-foreground text-[12px] font-medium transition-all active:scale-[0.97] hover:bg-muted/80 disabled:opacity-40">
				Cancel
			</button>
		</div>
	{/if}
</div>
