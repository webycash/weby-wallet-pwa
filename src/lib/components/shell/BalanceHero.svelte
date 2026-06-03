<script lang="ts">
	// Centered balance hero — the DashboardView visual language, generalised over
	// an asset family. Big tabular-nums figure, tiny USD/hide controls, an
	// optional testnet eyebrow. Pure presentational: it owns only the local
	// USD/hide toggles; the balance + formatter are props.
	import type { NetworkMode } from '$lib/core/types';

	let { symbol = '', display, usdDisplay = null, network }: {
		symbol?: string;
		display: string;
		usdDisplay?: string | null;
		network: NetworkMode;
	} = $props();

	let hidden = $state(false);
	let showUsd = $state(false);
	const canUsd = $derived(usdDisplay !== null);
</script>

<div class="py-6 md:py-10 text-center animate-fade-in">
	<div class="flex justify-center gap-2 mb-4">
		{#if canUsd}
			<button onclick={() => showUsd = !showUsd}
				class="rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 {showUsd ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}">
				USD
			</button>
		{/if}
		<button onclick={() => hidden = !hidden}
			class="rounded-full p-1.5 text-muted-foreground hover:text-foreground transition-all duration-200"
			aria-label={hidden ? 'Show balance' : 'Hide balance'}>
			{#if hidden}<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878A3 3 0 0112 9c1.657 0 3 1.343 3 3a3 3 0 01-.878 2.121M15 12a3 3 0 01-3 3m0 0l6.878 6.878M21 21l-3.878-3.878"/></svg>{:else}<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>{/if}
		</button>
	</div>

	{#if network === 'testnet'}
		<p class="text-[10px] font-medium text-muted-foreground tracking-[0.2em] uppercase mb-3">Testnet</p>
	{/if}

	{#if hidden}
		<p class="text-6xl md:text-7xl font-normal text-foreground tracking-tight">{symbol} ••••••</p>
	{:else if showUsd && usdDisplay}
		<p class="text-6xl md:text-7xl font-normal text-foreground tracking-tight tabular-nums">{usdDisplay}</p>
	{:else}
		<p class="text-6xl md:text-7xl font-normal text-foreground tracking-tight tabular-nums">{symbol ? `${symbol} ` : ''}{display}</p>
	{/if}
</div>
