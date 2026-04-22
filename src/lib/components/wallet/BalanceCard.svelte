<script lang="ts">
	import type { NetworkMode } from '$lib/core/types';
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
	const fmtDisplay = (s: string): string => {
		if (!s.includes('.')) return s + '.00';
		const trimmed = s.replace(/0+$/, '');
		if (trimmed.endsWith('.')) return trimmed + '00';
		if (trimmed.split('.')[1].length === 1) return trimmed + '0';
		return trimmed;
	};
	const display = $derived(fmtDisplay(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8)));
	const usdValue = $derived((balanceWats / 1e8) * usdPrice);
	const usdDisplay = $derived(usdValue === 0 ? '$0.00' : usdValue < 0.01 ? `$${usdValue.toFixed(6)}` : `$${usdValue.toFixed(2)}`);
</script>

<div class="py-10 text-center relative">
	<div class="flex justify-center gap-2 mb-6">
		<button onclick={() => showUsd = !showUsd}
			class="rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 {showUsd ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}">
			USD
		</button>
		<button onclick={() => hidden = !hidden}
			class="rounded-full p-1.5 text-muted-foreground hover:text-foreground transition-all duration-200">
			{#if hidden}<EyeOff class="w-3.5 h-3.5" />{:else}<Eye class="w-3.5 h-3.5" />{/if}
		</button>
	</div>

	{#if network === 'testnet'}
		<p class="text-[10px] font-medium text-muted-foreground tracking-[0.2em] uppercase mb-3">Testnet</p>
	{/if}

	{#if hidden}
		<p class="text-5xl md:text-6xl font-light text-foreground tracking-tight">{WEBCASH_SYMBOL} ••••••</p>
	{:else if showUsd}
		<p class="text-5xl md:text-6xl font-light text-foreground tracking-tight tabular-nums">{usdDisplay}</p>
	{:else}
		<p class="text-5xl md:text-6xl font-light text-foreground tracking-tight tabular-nums">{WEBCASH_SYMBOL} {display}</p>
	{/if}
</div>
