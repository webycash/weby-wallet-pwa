<script lang="ts">
	import type { WalletStats } from '$lib/core/types';
	import { Coins, CircleCheck, CircleX, Database } from '@lucide/svelte';
	let { stats, formatAmount }: { stats: WalletStats; formatAmount: ((w: number) => string) | null } = $props();
</script>

<div class="rounded-2xl border-2 border-border bg-card overflow-hidden">
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
		<div class="bg-card px-4 py-3">
			<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
				<CircleCheck class="w-3 h-3 text-success" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Unspent</span>
			</div>
			<p class="text-lg font-bold text-foreground tabular-nums">{stats.unspentWebcash}</p>
		</div>
		<div class="bg-card px-4 py-3">
			<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
				<CircleX class="w-3 h-3 text-danger-foreground" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Spent</span>
			</div>
			<p class="text-lg font-bold text-foreground tabular-nums">{stats.spentWebcash}</p>
		</div>
		<div class="bg-card px-4 py-3">
			<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
				<Database class="w-3 h-3" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Total</span>
			</div>
			<p class="text-lg font-bold text-foreground tabular-nums">{stats.totalWebcash}</p>
		</div>
		<div class="bg-card px-4 py-3">
			<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
				<Coins class="w-3 h-3 text-primary" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Balance</span>
			</div>
			<p class="text-lg font-bold text-foreground tabular-nums">{formatAmount ? formatAmount(stats.totalBalance) : stats.totalBalance}</p>
		</div>
	</div>
</div>
