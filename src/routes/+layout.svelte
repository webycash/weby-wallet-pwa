<script lang="ts">
	import '../app.css';
	import BackupWarning from '$lib/components/wallet/BackupWarning.svelte';
	import { walletExists, backedUp } from '$lib/stores/settings.svelte';

	let { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
	<header class="border-b border-border/40 px-4 py-3">
		<div class="container mx-auto flex items-center justify-between max-w-2xl">
			<a href="/" class="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
				<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
					<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
					<text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold">W</text>
				</svg>
				Weby Wallet
			</a>
			<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
				v0.1.0
			</span>
		</div>
	</header>

	{#if walletExists() && !backedUp()}
		<BackupWarning />
	{/if}

	<main class="flex-1">
		{@render children()}
	</main>

	<footer class="border-t border-border/40 px-4 py-3 text-center">
		<p class="text-xs text-muted-foreground">
			All data stays on your device.
			<a href="https://github.com/webycash/weby-wallet-pwa" target="_blank" rel="noopener" class="underline hover:text-foreground">Source</a>
		</p>
	</footer>
</div>
