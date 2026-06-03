<script lang="ts">
	import {
		computePublicationFee,
		perSeederFeePercent,
		type Seeder
	} from '$lib/modules/webycash-exchange';

	let {
		orderValue,
		seeders
	}: {
		orderValue: number;
		seeders: Seeder[];
	} = $props();

	const fee = $derived(computePublicationFee(orderValue, seeders));
	const activeCount = $derived(seeders.filter((s) => s.active).length);
	const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
</script>

<div class="rounded-2xl bg-muted/20 px-4 py-3 space-y-2">
	<div class="flex items-center justify-between text-[12px]">
		<span class="text-muted-foreground">Publication fee (0.1%)</span>
		<span class="font-semibold tabular-nums">{fmt(fee.totalFee)}</span>
	</div>

	{#if !fee.allowed}
		<div class="rounded-xl bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
			{#if fee.blockedReason === 'no-active-seeders'}
				No active seeders are available to seed this order. Publishing is blocked until at least one seeder is active.
			{:else}
				A seeder requested an unsupported fee rail. Only Webcash and Bitcoin ARK are accepted.
			{/if}
		</div>
	{:else}
		<div class="flex items-center justify-between text-[11px] text-muted-foreground">
			<span>{activeCount} active seeder{activeCount === 1 ? '' : 's'}</span>
			<span class="tabular-nums">{perSeederFeePercent(activeCount).toFixed(3)}% each</span>
		</div>
		<div class="space-y-px max-h-28 overflow-y-auto">
			{#each fee.shares as s (s.seederFingerprint)}
				<div class="flex items-center justify-between text-[11px] tabular-nums">
					<span class="font-mono text-muted-foreground/80 truncate max-w-[60%]">
						{s.seederFingerprint.slice(0, 10)}…
					</span>
					<span class="flex items-center gap-1.5">
						<span class="px-1.5 py-0.5 rounded-full bg-muted/50 text-[9px] uppercase">{s.rail === 'bitcoin_ark' ? 'ARK' : 'WC'}</span>
						{fmt(s.amount)}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
