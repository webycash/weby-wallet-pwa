<script lang="ts">
	import { startMining, stopMining, isMining } from '$lib/core/miner';
	import { getMasterSecret, getDb } from '$lib/stores/wallet.svelte';
	import { getDepth } from '$lib/core/storage';
	import type { NetworkMode } from '$lib/core/types';

	let { network }: { network: NetworkMode } = $props();

	let running = $state(false);
	let hashRate = $state(0);
	let result = $state('');

	const toggle = async () => {
		if (running) {
			stopMining();
			running = false;
			return;
		}

		const secret = await getMasterSecret();
		if (!secret) return;

		const db = await getDb();
		const depth = await getDepth(db, 'MINING');

		running = true;
		result = '';

		await startMining(network, secret, depth, (state) => {
			running = state.running;
			hashRate = state.hashRate;
			if (state.found && state.result) {
				result = state.result;
			}
		});
	};
</script>

<div class="rounded-xl border border-border bg-card p-4">
	<h3 class="text-xs font-medium text-muted-foreground tracking-wider uppercase mb-3">CPU Miner (Testnet)</h3>

	<div class="flex items-center justify-between mb-3">
		<div class="text-sm">
			{#if running}
				<span class="text-primary font-medium">{hashRate.toLocaleString()} H/s</span>
			{:else}
				<span class="text-muted-foreground">Idle</span>
			{/if}
		</div>
		<button onclick={toggle}
			class="rounded-lg px-4 py-2 text-sm font-medium transition-colors
				{running ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}">
			{running ? 'Stop' : 'Start Mining'}
		</button>
	</div>

	{#if result}
		<div class="rounded-lg bg-primary/10 border border-primary/20 p-3">
			<p class="text-xs text-primary font-medium mb-1">Mined!</p>
			<code class="text-xs font-mono text-muted-foreground break-all">{result}</code>
		</div>
	{/if}
</div>
