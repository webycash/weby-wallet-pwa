<script lang="ts">
	import type { NetworkMode } from '$lib/core/types';
	let { balanceWats, formatAmount, network }: {
		balanceWats: number;
		formatAmount: ((w: number) => string) | null;
		network: NetworkMode;
	} = $props();

	const display = $derived(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8));
</script>

<div class="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/8 via-primary/3 to-transparent p-8">
	<div class="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
	<div class="relative">
		<p class="text-xs font-medium text-muted-foreground/70 tracking-widest uppercase mb-2">
			{network === 'testnet' ? 'Testnet Balance' : 'Balance'}
		</p>
		<p class="text-4xl sm:text-5xl font-bold text-foreground tracking-tight tabular-nums">
			{display}
		</p>
		<p class="text-sm text-muted-foreground/50 mt-1 font-medium">webcash</p>
	</div>
</div>
