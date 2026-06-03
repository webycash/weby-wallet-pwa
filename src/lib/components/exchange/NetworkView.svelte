<script lang="ts">
	/** Network — the extro layer made visible. PA2AP participants (peers AND
	 * agents), seeders for this market, the orderbook source, an on-demand fetch,
	 * and the seeder-fee economics. Counts are mock until DHTX/keyserver lands. */
	import { Users, Bot, Boxes, RefreshCw } from '@lucide/svelte';
	import { orderbook, type Seeder } from '$lib/modules/webycash-exchange';
	import { getExtroMode } from '$lib/extro';
	import { mockNetwork } from '$lib/modules/webycash-exchange/view-data';

	let {
		seeders,
		onRefresh,
		setSeederCount
	}: {
		seeders: Seeder[];
		onRefresh: () => void;
		setSeederCount: (n: number) => void;
	} = $props();

	const activeSeeders = $derived(seeders.filter((s) => s.active).length);
	const net = $derived(mockNetwork(orderbook.pair, activeSeeders));
</script>

<div class="space-y-4">
	<h2 class="text-[17px] font-semibold px-1">Network</h2>

	<div class="grid grid-cols-3 gap-3">
		<div class="rounded-2xl bg-muted/20 p-4 text-center">
			<Users class="w-5 h-5 mx-auto mb-1 text-primary" />
			<p class="text-2xl font-normal tabular-nums">{net.peers}</p>
			<p class="text-[11px] text-muted-foreground">Peers</p>
		</div>
		<div class="rounded-2xl bg-muted/20 p-4 text-center">
			<Bot class="w-5 h-5 mx-auto mb-1 text-primary" />
			<p class="text-2xl font-normal tabular-nums">{net.agents}</p>
			<p class="text-[11px] text-muted-foreground">Agents</p>
		</div>
		<div class="rounded-2xl bg-muted/20 p-4 text-center">
			<Boxes class="w-5 h-5 mx-auto mb-1 text-primary" />
			<p class="text-2xl font-normal tabular-nums">{net.seeders}</p>
			<p class="text-[11px] text-muted-foreground">Seeders</p>
		</div>
	</div>

	<p class="text-[12px] text-muted-foreground px-1 leading-relaxed">
		Extro is a <span class="text-foreground font-medium">peer-and-agent</span> network: humans and autonomous
		agents trade as equals — peer↔peer, agent↔agent, peer↔agent.
	</p>

	<div class="rounded-2xl bg-muted/20 p-4 space-y-3">
		<div class="flex items-center justify-between">
			<span class="text-[13px]">Orderbook source</span>
			<span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground">{orderbook.source ?? 'mock'} · {getExtroMode()} node</span>
		</div>
		<button
			onclick={onRefresh}
			class="w-full h-11 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-[14px] font-medium active:scale-[0.97] transition-all duration-200">
			<RefreshCw class="w-4 h-4" />
			Fetch order book
		</button>
	</div>

	<div class="rounded-2xl bg-muted/20 p-4 space-y-2">
		<p class="text-[13px]">
			Publishing pays seeders <span class="font-medium">0.1%</span> of order value, split equally.
		</p>
		<div class="flex items-center gap-2 text-[11px] text-muted-foreground">
			<span>Mock seeders:</span>
			{#each [0, 1, 2, 10] as n}
				<button
					onclick={() => setSeederCount(n)}
					class="px-2 py-0.5 rounded-full transition-colors {activeSeeders === n ? 'bg-primary/10 text-primary' : 'bg-muted/40 hover:bg-muted/60'}">{n}</button>
			{/each}
		</div>
	</div>
</div>
