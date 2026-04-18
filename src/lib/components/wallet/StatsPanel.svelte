<script lang="ts">
	let { stats, formatAmount }: { stats: any; formatAmount: ((w: number) => string) | null } = $props();
</script>

<div class="px-2 space-y-5">
	<div class="grid grid-cols-3 gap-6">
		<div>
			<p class="text-xs text-muted-foreground mb-1">Mined</p>
			<p class="text-lg font-semibold text-foreground tabular-nums">{stats.mined_count ?? 0}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground mb-1">Received</p>
			<p class="text-lg font-semibold text-foreground tabular-nums">{stats.received_count ?? 0}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground mb-1">Sent</p>
			<p class="text-lg font-semibold text-foreground tabular-nums">{stats.sent_count ?? 0}</p>
		</div>
	</div>
	<div class="grid grid-cols-3 gap-6">
		<div>
			<p class="text-xs text-muted-foreground mb-1">Unspent</p>
			<p class="text-lg font-semibold text-foreground tabular-nums">{stats.unspent_webcash ?? stats.unspentWebcash ?? 0}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground mb-1">Spent</p>
			<p class="text-lg font-semibold text-foreground tabular-nums">{stats.spent_webcash ?? stats.spentWebcash ?? 0}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground mb-1">Balance</p>
			<p class="text-lg font-semibold text-foreground tabular-nums">{formatAmount ? formatAmount(stats.total_balance ?? stats.totalBalance ?? 0) : (stats.total_balance ?? stats.totalBalance ?? 0)}</p>
		</div>
	</div>
</div>
