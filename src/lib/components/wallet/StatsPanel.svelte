<script lang="ts">
	import type { WalletStats } from '$lib/core/types';
	let { stats, formatAmount }: { stats: WalletStats; formatAmount: ((w: number) => string) | null } = $props();
</script>

<div class="rounded-xl border border-border bg-card p-4">
	<h3 class="text-xs font-medium text-muted-foreground tracking-wider uppercase mb-3">Info</h3>
	<div class="grid grid-cols-2 gap-3 text-sm">
		<div>
			<span class="text-muted-foreground">Unspent</span>
			<span class="float-right font-medium">{stats.unspentWebcash}</span>
		</div>
		<div>
			<span class="text-muted-foreground">Spent</span>
			<span class="float-right font-medium">{stats.spentWebcash}</span>
		</div>
		<div>
			<span class="text-muted-foreground">Total entries</span>
			<span class="float-right font-medium">{stats.totalWebcash}</span>
		</div>
		<div>
			<span class="text-muted-foreground">Balance</span>
			<span class="float-right font-medium">{formatAmount ? formatAmount(stats.totalBalance) : stats.totalBalance}</span>
		</div>
	</div>
</div>
