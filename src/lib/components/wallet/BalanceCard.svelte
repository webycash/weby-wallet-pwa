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

	// Mining cost formula from harmoniis marketplace:
	// Price = (rig_cost_per_hour / min(3600 / (2^difficulty / hashrate_hps), 600)) / mining_amount
	const RIG_HASHRATE_GHS = 14.5; // RTX 4090
	const RIG_COST_PER_HOUR = 0.24; // Vast.ai market rate
	const MAX_SOLUTIONS_PER_HOUR = 600; // Server cap: 1 report / 6s
	const DIFFICULTY = 28; // Current mainnet approximate
	const MINING_AMOUNT = 195.3125; // Current epoch

	const estimateUsdPrice = (): number => {
		const hashes = Math.pow(2, DIFFICULTY);
		const hashrate_hps = RIG_HASHRATE_GHS * 1_000_000_000;
		const seconds_per_solution = hashes / hashrate_hps;
		const gpu_solutions_per_hour = 3600 / seconds_per_solution;
		const solutions_per_hour = Math.min(gpu_solutions_per_hour, MAX_SOLUTIONS_PER_HOUR);
		const cost_per_solution = RIG_COST_PER_HOUR / solutions_per_hour;
		return cost_per_solution / MINING_AMOUNT;
	};

	const usdPrice = estimateUsdPrice();
	const display = $derived(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8));
	const usdValue = $derived((balanceWats / 1e8) * usdPrice);
	const usdDisplay = $derived(usdValue < 0.01 ? '< $0.01' : `$${usdValue.toFixed(2)}`);
</script>

<div class="relative overflow-hidden rounded-3xl border-2 border-primary/15 bg-gradient-to-br from-primary/8 via-primary/3 to-transparent p-8">
	<div class="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>

	<!-- Toggle buttons -->
	<div class="absolute top-4 right-4 flex gap-1">
		<button onclick={() => showUsd = !showUsd}
			class="rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all
				{showUsd ? 'bg-primary/10 text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'}">
			USD
		</button>
		<button onclick={() => hidden = !hidden}
			class="rounded-full p-1.5 text-muted-foreground/40 hover:text-muted-foreground transition-all">
			{#if hidden}
				<EyeOff class="w-3.5 h-3.5" />
			{:else}
				<Eye class="w-3.5 h-3.5" />
			{/if}
		</button>
	</div>

	<div class="relative text-center">
		<p class="text-xs font-medium text-muted-foreground/70 tracking-widest uppercase mb-3">
			{network === 'testnet' ? 'Testnet Balance' : 'Balance'}
		</p>

		{#if hidden}
			<p class="text-4xl sm:text-5xl font-bold text-foreground tracking-tight">
				{WEBCASH_SYMBOL} ••••••
			</p>
		{:else if showUsd}
			<p class="text-4xl sm:text-5xl font-bold text-foreground tracking-tight tabular-nums">
				{usdDisplay}
			</p>
			<p class="text-sm text-muted-foreground/50 mt-2 font-medium">
				{WEBCASH_SYMBOL} {display}
			</p>
		{:else}
			<p class="text-4xl sm:text-5xl font-bold text-foreground tracking-tight tabular-nums">
				{WEBCASH_SYMBOL} {display}
			</p>
			{#if network !== 'testnet' && balanceWats > 0}
				<p class="text-sm text-muted-foreground/50 mt-2 font-medium tabular-nums">
					~ {usdDisplay}
				</p>
			{/if}
		{/if}

		{#if network !== 'testnet'}
			<p class="text-[10px] text-muted-foreground/30 mt-3">
				Mining cost: {WEBCASH_SYMBOL}1 ~ ${usdPrice.toFixed(6)}
			</p>
		{/if}
	</div>
</div>
