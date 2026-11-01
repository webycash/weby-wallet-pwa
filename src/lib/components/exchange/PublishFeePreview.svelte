<script lang="ts">
	import {
		perSeederFeePercent,
		publicationFeeNode,
		type PublicationFee,
		type Seeder
	} from '$lib/modules/webycash-exchange';
	import { getExtroClient } from '$lib/extro';

	let {
		orderValue,
		seeders
	}: {
		orderValue: number;
		seeders: Seeder[];
	} = $props();

	// Computed by extro-node (Op::Exchange PublicationFee).
	let fee = $state<PublicationFee>({ allowed: true, totalFee: 0, shares: [] });
	let feeError = $state<string | null>(null);
	$effect(() => {
		const client = getExtroClient();
		let stale = false;
		feeError = null;
		publicationFeeNode((c) => client.send(c), orderValue, seeders).then(
			(f) => {
				if (!stale) fee = f;
			},
			(e) => {
				if (!stale) feeError = e instanceof Error ? e.message : String(e);
			}
		);
		return () => {
			stale = true;
		};
	});
	const activeCount = $derived(seeders.filter((s) => s.active).length);
	const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
</script>

<div class="rounded-2xl bg-muted/20 px-4 py-3 space-y-2">
	<div class="flex items-center justify-between text-[12px]">
		<span class="text-muted-foreground">Publication fee (0.1%)</span>
		<span class="font-semibold tabular-nums">{fmt(fee.totalFee)}</span>
	</div>

	{#if feeError}
		<div class="rounded-xl bg-destructive/10 text-destructive px-3 py-2 text-[12px]">{feeError}</div>
	{:else if !fee.allowed}
		<div class="rounded-xl {fee.blockedReason === 'no-active-seeders' ? 'bg-primary/8 text-primary' : 'bg-destructive/10 text-destructive'} px-3 py-2 text-[12px]">
			{#if fee.blockedReason === 'no-active-seeders'}
				No other seeders yet — you'll be the first maker. Your node self-seeds this order (no fee) and relays it to every peer that connects.
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
