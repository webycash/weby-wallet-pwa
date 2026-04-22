<script lang="ts">
	import MinerPanel from './MinerPanel.svelte';
	import type { NetworkMode } from '$lib/core/types';

	let { network, canMineWallet, onBalanceUpdate }: {
		network: NetworkMode;
		canMineWallet: boolean;
		onBalanceUpdate: () => void;
	} = $props();
</script>

<div class="animate-fade-in">
	{#if canMineWallet}
		<MinerPanel {network} {onBalanceUpdate} />
	{:else}
		<div class="rounded-xl border border-border p-8 text-center">
			<p class="text-muted-foreground text-sm">Mining is only available on the main wallet.</p>
		</div>
	{/if}
</div>
