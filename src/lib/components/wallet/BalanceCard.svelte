<script lang="ts">
	import type { NetworkMode } from '$lib/core/types';
	import * as Card from '$lib/components/ui/card';
	import { Eye, EyeOff } from '@lucide/svelte';

	let { balanceWats, formatAmount, network }: {
		balanceWats: number;
		formatAmount: ((w: number) => string) | null;
		network: NetworkMode;
	} = $props();

	let hidden = $state(false);
	let showUsd = $state(false);

	const WEBCASH_SYMBOL = '₩';
	const RIG_HASHRATE_GHS = 14.5;
	const RIG_COST_PER_HOUR = 0.24;
	const MAX_SOLUTIONS_PER_HOUR = 600;
	const DIFFICULTY = 28;
	const MINING_AMOUNT = 195.3125;

	const estimateUsdPrice = (): number => {
		const hashes = Math.pow(2, DIFFICULTY);
		const hashrate_hps = RIG_HASHRATE_GHS * 1_000_000_000;
		const seconds_per_solution = hashes / hashrate_hps;
		const gpu_solutions_per_hour = 3600 / seconds_per_solution;
		const solutions_per_hour = Math.min(gpu_solutions_per_hour, MAX_SOLUTIONS_PER_HOUR);
		return RIG_COST_PER_HOUR / solutions_per_hour / MINING_AMOUNT;
	};

	const usdPrice = estimateUsdPrice();
	const display = $derived(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8));
	const usdValue = $derived((balanceWats / 1e8) * usdPrice);
	const usdDisplay = $derived(usdValue < 0.01 ? '< $0.01' : `$${usdValue.toFixed(2)}`);
</script>

<Card.Root>
	<Card.Content class="p-8 text-center relative">
		<div class="absolute top-4 right-4 flex gap-1">
			<button onclick={() => showUsd = !showUsd}
				class="rounded-full px-2.5 py-1 text-xs font-semibold transition-all {showUsd ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
				USD
			</button>
			<button onclick={() => hidden = !hidden}
				class="rounded-full p-1.5 text-muted-foreground hover:text-foreground transition-all">
				{#if hidden}<EyeOff class="w-3.5 h-3.5" />{:else}<Eye class="w-3.5 h-3.5" />{/if}
			</button>
		</div>

		<p class="text-xs font-medium text-muted-foreground tracking-widest uppercase mb-3">
			{network === 'testnet' ? 'Testnet Balance' : 'Balance'}
		</p>

		{#if hidden}
			<p class="text-4xl sm:text-5xl font-bold text-foreground tracking-tight">{WEBCASH_SYMBOL} ••••••</p>
		{:else if showUsd}
			<p class="text-4xl sm:text-5xl font-bold text-foreground tracking-tight tabular-nums">{usdDisplay}</p>
			<p class="text-sm text-muted-foreground mt-2 font-medium">{WEBCASH_SYMBOL} {display}</p>
		{:else}
			<p class="text-4xl sm:text-5xl font-bold text-foreground tracking-tight tabular-nums">{WEBCASH_SYMBOL} {display}</p>
			{#if network !== 'testnet' && balanceWats > 0}
				<p class="text-sm text-muted-foreground mt-2 font-medium tabular-nums">~ {usdDisplay}</p>
			{/if}
		{/if}

		{#if network !== 'testnet'}
			<p class="text-sm text-muted-foreground mt-4 font-medium">Mining cost: {WEBCASH_SYMBOL}1 ~ ${usdPrice.toFixed(6)}</p>
		{/if}
	</Card.Content>
</Card.Root>
