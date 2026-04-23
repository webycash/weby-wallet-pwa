<script lang="ts">
	import type { SecretWebcash, WalletStats } from '$lib/core/types';
	import { Copy, Check } from '@lucide/svelte';

	let { stats, webcash, formatAmount }: {
		stats: WalletStats | null;
		webcash: SecretWebcash[];
		formatAmount: ((w: number) => string) | null;
	} = $props();

	let copiedIdx = $state(-1);
	const trim = (s: string): string => s.includes('.') ? (s.replace(/0+$/, '').replace(/\.$/, '') || '0') : s;
	const fmt = (wats: number) => trim(formatAmount ? formatAmount(wats) : (wats / 1e8).toFixed(8));

	const copySecret = async (secret: string, idx: number) => {
		await navigator.clipboard.writeText(secret);
		copiedIdx = idx;
		setTimeout(() => { copiedIdx = -1; }, 1500);
	};
</script>

<div class="space-y-6 animate-fade-in">
	{#if stats}
		<div>
			<h2 class="text-[15px] font-semibold mb-4">Stats</h2>
			<div class="space-y-3">
				<div class="grid grid-cols-3 gap-3 text-center">
					<div class="rounded-2xl bg-card p-3.5">
						<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Mined</p>
						<p class="text-xl font-semibold tabular-nums">{stats.mined_count ?? 0}</p>
					</div>
					<div class="rounded-2xl bg-card p-3.5">
						<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Received</p>
						<p class="text-xl font-semibold tabular-nums">{stats.received_count ?? 0}</p>
					</div>
					<div class="rounded-2xl bg-card p-3.5">
						<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Sent</p>
						<p class="text-xl font-semibold tabular-nums">{stats.sent_count ?? 0}</p>
					</div>
				</div>
				<div class="grid grid-cols-3 gap-3 text-center">
					<div class="rounded-2xl bg-card p-3.5">
						<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Unspent</p>
						<p class="text-base font-semibold tabular-nums">{stats.unspent_webcash ?? 0}</p>
					</div>
					<div class="rounded-2xl bg-card p-3.5">
						<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Spent</p>
						<p class="text-base font-semibold tabular-nums">{stats.spent_webcash ?? 0}</p>
					</div>
					<div class="rounded-2xl bg-card p-3.5">
						<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Balance</p>
						<p class="text-base font-semibold tabular-nums truncate">{fmt(stats.total_balance ?? 0)}</p>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if webcash.length > 0}
		<div>
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-[15px] font-semibold">Log</h2>
				<span class="text-[11px] text-muted-foreground bg-muted/60 rounded-full px-2.5 py-0.5">{webcash.length}</span>
			</div>
			<div class="rounded-2xl bg-card overflow-hidden">
				<div class="max-h-96 overflow-y-auto">
					{#each webcash as wc, i}
						<div class="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-all duration-150
							{i > 0 ? 'border-t border-muted/30' : ''}">
							<code class="text-[11px] text-muted-foreground font-mono truncate flex-1 min-w-0">
								{wc.secret.slice(0, 8)}...{wc.secret.slice(-8)}
							</code>
							<div class="flex items-center gap-3 shrink-0">
								<span class="text-sm font-semibold tabular-nums">{fmt(wc.amountWats)}</span>
								<button onclick={() => copySecret(wc.secret, i)}
									class="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200">
									{#if copiedIdx === i}
										<Check class="w-3.5 h-3.5 text-success" />
									{:else}
										<Copy class="w-3.5 h-3.5" />
									{/if}
								</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
