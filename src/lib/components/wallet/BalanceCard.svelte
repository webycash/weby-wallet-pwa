<script lang="ts">
	let { balanceWats, formatAmount }: { balanceWats: number; formatAmount: ((w: number) => string) | null } = $props();
	const display = $derived(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8));
</script>

<div class="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-6 text-center">
	<p class="text-xs font-medium text-muted-foreground tracking-wider uppercase mb-1">Balance</p>
	<p class="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">{display}</p>
	<p class="text-xs text-muted-foreground mt-1">webcash</p>
</div>
