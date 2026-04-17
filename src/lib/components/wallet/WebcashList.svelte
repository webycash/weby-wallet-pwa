<script lang="ts">
	import type { SecretWebcash } from '$lib/core/types';
	import { ChevronDown, Copy, Check } from '@lucide/svelte';
	let { webcash, formatAmount }: { webcash: SecretWebcash[]; formatAmount: ((w: number) => string) | null } = $props();

	let expanded = $state(false);
	let copiedIdx = $state(-1);

	const fmt = (wats: number) => formatAmount ? formatAmount(wats) : (wats / 1e8).toFixed(8);

	const copySecret = async (secret: string, idx: number) => {
		await navigator.clipboard.writeText(secret);
		copiedIdx = idx;
		setTimeout(() => { copiedIdx = -1; }, 1500);
	};
</script>

{#if webcash.length > 0}
	<div class="rounded-2xl border-2 border-border bg-card overflow-hidden">
		<button onclick={() => expanded = !expanded}
			class="w-full px-5 py-3.5 flex items-center justify-between hover:bg-muted transition-all">
			<span class="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
				Webcash
			</span>
			<div class="flex items-center gap-2">
				<span class="text-xs text-muted-foreground">{webcash.length} outputs</span>
				<ChevronDown class="w-4 h-4 text-muted-foreground transition-transform {expanded ? 'rotate-180' : ''}" />
			</div>
		</button>

		{#if expanded}
			<div class="border-t border-border divide-y divide-border/30 max-h-72 overflow-y-auto">
				{#each webcash as wc, i}
					<div class="px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted transition-all">
						<code class="text-xs text-muted-foreground font-mono truncate flex-1 min-w-0">
							{wc.secret.slice(0, 8)}...{wc.secret.slice(-8)}
						</code>
						<div class="flex items-center gap-3 shrink-0">
							<span class="text-sm font-semibold tabular-nums">{fmt(wc.amountWats)}</span>
							<button onclick={() => copySecret(wc.secret, i)}
								class="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
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
		{/if}
	</div>
{/if}
