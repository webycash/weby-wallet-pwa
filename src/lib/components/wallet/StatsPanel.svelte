<script lang="ts">
	import { Coins, CircleCheck, CircleX, Pickaxe, ArrowDownToLine, ArrowUpFromLine } from '@lucide/svelte';
	let { stats, formatAmount }: { stats: any; formatAmount: ((w: number) => string) | null } = $props();
</script>

<div class="rounded-xl bg-card overflow-hidden">
	<div class="grid grid-cols-3 gap-px bg-border">
		<div class="bg-card px-3 py-3 text-center">
			<div class="flex items-center justify-center gap-1 text-muted-foreground mb-1">
				<Pickaxe class="w-3 h-3 text-warning" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Mined</span>
			</div>
			<p class="text-base font-bold text-foreground tabular-nums">{stats.mined_count ?? 0}</p>
		</div>
		<div class="bg-card px-3 py-3 text-center">
			<div class="flex items-center justify-center gap-1 text-muted-foreground mb-1">
				<ArrowDownToLine class="w-3 h-3 text-success" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Received</span>
			</div>
			<p class="text-base font-bold text-foreground tabular-nums">{stats.received_count ?? 0}</p>
		</div>
		<div class="bg-card px-3 py-3 text-center">
			<div class="flex items-center justify-center gap-1 text-muted-foreground mb-1">
				<ArrowUpFromLine class="w-3 h-3 text-danger" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Sent</span>
			</div>
			<p class="text-base font-bold text-foreground tabular-nums">{stats.sent_count ?? 0}</p>
		</div>
	</div>
	<div class="grid grid-cols-3 gap-px bg-border border-t border-border">
		<div class="bg-card px-3 py-3 text-center">
			<div class="flex items-center justify-center gap-1 text-muted-foreground mb-1">
				<CircleCheck class="w-3 h-3 text-primary" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Unspent</span>
			</div>
			<p class="text-base font-bold text-foreground tabular-nums">{stats.unspent_webcash ?? stats.unspentWebcash ?? 0}</p>
		</div>
		<div class="bg-card px-3 py-3 text-center">
			<div class="flex items-center justify-center gap-1 text-muted-foreground mb-1">
				<CircleX class="w-3 h-3 text-muted-foreground" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Spent</span>
			</div>
			<p class="text-base font-bold text-foreground tabular-nums">{stats.spent_webcash ?? stats.spentWebcash ?? 0}</p>
		</div>
		<div class="bg-card px-3 py-3 text-center">
			<div class="flex items-center justify-center gap-1 text-muted-foreground mb-1">
				<Coins class="w-3 h-3 text-primary" />
				<span class="text-[10px] uppercase tracking-wider font-medium">Balance</span>
			</div>
			<p class="text-base font-bold text-foreground tabular-nums">{formatAmount ? formatAmount(stats.total_balance ?? stats.totalBalance ?? 0) : (stats.total_balance ?? stats.totalBalance ?? 0)}</p>
		</div>
	</div>
</div>
