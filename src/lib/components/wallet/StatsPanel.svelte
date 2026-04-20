<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	let { stats, formatAmount }: { stats: any; formatAmount: ((w: number) => string) | null } = $props();
	const trim = (s: string): string => s.includes('.') ? (s.replace(/0+$/, '').replace(/\.$/, '') || '0') : s;
	const fmt = (wats: number) => trim(formatAmount ? formatAmount(wats) : String(wats));
	let expanded = $state(false);
</script>

<div class="rounded-xl bg-card overflow-hidden">
	<button onclick={() => expanded = !expanded}
		class="w-full px-5 py-3 flex items-center justify-between hover:bg-muted transition-all">
		<span class="text-xs font-semibold text-muted-foreground tracking-wider">Stats</span>
		<ChevronDown class="w-4 h-4 text-muted-foreground transition-transform {expanded ? 'rotate-180' : ''}" />
	</button>

	{#if expanded}
		<div class="px-5 pt-2 pb-4 space-y-4">
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
	{/if}
</div>
