<script lang="ts">
	import {
		assetLabel,
		evaluatePair,
		type TradingPair
	} from '$lib/modules/webycash-exchange';

	let {
		pairs,
		selected,
		onSelect
	}: {
		pairs: TradingPair[];
		selected: TradingPair;
		onSelect: (p: TradingPair) => void;
	} = $props();

	const key = (p: TradingPair) => `${p.base}/${p.quote}`;
	const isSelected = (p: TradingPair) => key(p) === key(selected);
</script>

<div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Trading pair">
	{#each pairs as p (key(p))}
		{@const verdict = evaluatePair(p.base, p.quote)}
		<button
			role="tab"
			aria-selected={isSelected(p)}
			onclick={() => onSelect(p)}
			class="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all duration-200 whitespace-nowrap
				{isSelected(p)
					? 'bg-primary/10 text-primary'
					: 'bg-muted/40 text-muted-foreground hover:bg-muted/60'}">
			<span>{assetLabel(p.base)}</span>
			<span class="opacity-40">/</span>
			<span>{assetLabel(p.quote)}</span>
			{#if !verdict.allowed}
				<span
					class="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold"
					title="This pair is blocked by policy">blocked</span>
			{:else if verdict.requiresReferee}
				<span
					class="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-semibold"
					title="Referee-mediated, non-atomic">referee</span>
			{/if}
		</button>
	{/each}
</div>
