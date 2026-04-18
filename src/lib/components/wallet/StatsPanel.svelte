<script lang="ts">
	let { stats, formatAmount }: { stats: any; formatAmount: ((w: number) => string) | null } = $props();
	const trim = (s: string): string => s.includes('.') ? (s.replace(/0+$/, '').replace(/\.$/, '') || '0') : s;
	const fmt = (wats: number) => trim(formatAmount ? formatAmount(wats) : String(wats));
</script>

<div class="pt-4 space-y-4">
	<div class="grid grid-cols-3 gap-3 sm:gap-6 text-center">
		<div>
			<p class="text-[11px] text-muted-foreground mb-0.5">Mined</p>
			<p class="text-base sm:text-lg font-semibold text-foreground tabular-nums">{stats.mined_count ?? 0}</p>
		</div>
		<div>
			<p class="text-[11px] text-muted-foreground mb-0.5">Received</p>
			<p class="text-base sm:text-lg font-semibold text-foreground tabular-nums">{stats.received_count ?? 0}</p>
		</div>
		<div>
			<p class="text-[11px] text-muted-foreground mb-0.5">Sent</p>
			<p class="text-base sm:text-lg font-semibold text-foreground tabular-nums">{stats.sent_count ?? 0}</p>
		</div>
	</div>
	<div class="grid grid-cols-3 gap-3 sm:gap-6 text-center">
		<div>
			<p class="text-[11px] text-muted-foreground mb-0.5">Unspent</p>
			<p class="text-base sm:text-lg font-semibold text-foreground tabular-nums">{stats.unspent_webcash ?? stats.unspentWebcash ?? 0}</p>
		</div>
		<div>
			<p class="text-[11px] text-muted-foreground mb-0.5">Spent</p>
			<p class="text-base sm:text-lg font-semibold text-foreground tabular-nums">{stats.spent_webcash ?? stats.spentWebcash ?? 0}</p>
		</div>
		<div>
			<p class="text-[11px] text-muted-foreground mb-0.5">Balance</p>
			<p class="text-base sm:text-lg font-semibold text-foreground tabular-nums truncate">{fmt(stats.total_balance ?? stats.totalBalance ?? 0)}</p>
		</div>
	</div>
</div>
