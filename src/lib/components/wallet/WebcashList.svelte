<script lang="ts">
	import type { SecretWebcash } from '$lib/core/types';
	let { webcash, formatAmount }: { webcash: SecretWebcash[]; formatAmount: ((w: number) => string) | null } = $props();

	let expanded = $state(false);

	const copySecret = (secret: string) => {
		navigator.clipboard.writeText(secret);
	};

	const fmt = (wats: number) => formatAmount ? formatAmount(wats) : (wats / 1e8).toFixed(8);
</script>

{#if webcash.length > 0}
	<div class="rounded-xl border border-border bg-card">
		<button onclick={() => expanded = !expanded}
			class="w-full px-4 py-3 text-left flex items-center justify-between">
			<span class="text-xs font-medium text-muted-foreground tracking-wider uppercase">
				Webcash ({webcash.length})
			</span>
			<span class="text-xs text-muted-foreground">{expanded ? 'Hide' : 'Show'}</span>
		</button>

		{#if expanded}
			<div class="border-t border-border divide-y divide-border/50 max-h-64 overflow-y-auto">
				{#each webcash as wc}
					<div class="px-4 py-2 flex items-center justify-between gap-2">
						<code class="text-xs text-muted-foreground font-mono truncate max-w-[60%]">{wc.secret}</code>
						<div class="flex items-center gap-2 shrink-0">
							<span class="text-sm font-medium">{fmt(wc.amountWats)}</span>
							<button onclick={() => copySecret(wc.secret)}
								class="text-xs text-primary hover:text-primary/80 transition-colors">
								Copy
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
