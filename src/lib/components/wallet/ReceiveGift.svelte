<script lang="ts">
	import type { NetworkMode } from '$lib/core/types';
	import { CheckCircle, AlertCircle, Copy, Check } from '@lucide/svelte';

	let { amount, memo = '', network, success, error, onContinue }: {
		amount: string;
		memo?: string;
		network: NetworkMode;
		success: boolean;
		error: string;
		onContinue: () => void;
	} = $props();

	let copiedError = $state(false);
	const copyError = async () => {
		await navigator.clipboard.writeText(error);
		copiedError = true;
		setTimeout(() => { copiedError = false; }, 2000);
	};

	const WEBCASH_SYMBOL = '₩';
	const displayAmount = $derived(amount || '?');
</script>

<div class="min-h-[60vh] flex items-center justify-center px-4 py-12">
	<div class="w-full max-w-sm">
		<div class="rounded-3xl border border-border bg-card p-8 text-center">
			{#if success}
				<div class="w-16 h-16 rounded-full bg-success flex items-center justify-center mx-auto mb-4">
					<CheckCircle class="w-8 h-8 text-success-foreground" />
				</div>
				<p class="text-xs font-medium text-success uppercase tracking-widest mb-3">Received</p>
				<p class="text-5xl font-bold text-foreground tracking-tight tabular-nums mb-2">
					{WEBCASH_SYMBOL}{displayAmount}
				</p>
				<p class="text-sm text-muted-foreground">webcash</p>
				{#if memo}
					<p class="text-sm text-muted-foreground mt-3 italic">"{memo}"</p>
				{/if}
				{#if network === 'testnet'}
					<span class="inline-block mt-3 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Testnet</span>
				{/if}

			{:else if error}
				<div class="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-4">
					<AlertCircle class="w-8 h-8 text-danger" />
				</div>
				<p class="text-xs font-medium text-danger uppercase tracking-widest mb-3">Failed</p>
				<p class="text-5xl font-bold text-foreground tracking-tight tabular-nums mb-2">
					{WEBCASH_SYMBOL}{displayAmount}
				</p>
				{#if memo}<p class="text-sm text-muted-foreground mt-2 italic">"{memo}"</p>{/if}
				<p class="text-sm text-muted-foreground mt-4">{error}</p>
				<button onclick={copyError}
					class="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-all">
					{#if copiedError}
						<Check class="w-3 h-3" /> Copied
					{:else}
						<Copy class="w-3 h-3" /> Copy error
					{/if}
				</button>

			{:else}
				<div class="w-16 h-16 rounded-full border-2 border-primary flex items-center justify-center mx-auto mb-4 animate-pulse">
					<span class="text-3xl font-bold text-primary">W</span>
				</div>
				<p class="text-xs font-medium text-primary uppercase tracking-widest mb-3">Receiving</p>
				<p class="text-5xl font-bold text-foreground tracking-tight tabular-nums mb-2">
					{WEBCASH_SYMBOL}{displayAmount}
				</p>
				{#if memo}<p class="text-sm text-muted-foreground mt-2 italic">"{memo}"</p>{/if}
				<p class="text-sm text-muted-foreground mt-2">Setting up your wallet...</p>
			{/if}
		</div>

		{#if success || error}
			<button onclick={onContinue}
				class="mt-6 w-full flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all">
				{success ? 'Open Wallet' : 'Try Again'}
			</button>
			{#if error}
				<button onclick={onContinue}
					class="mt-3 w-full text-sm text-muted-foreground hover:text-foreground transition-all">
					Go to Wallet
				</button>
			{/if}
		{/if}
	</div>
</div>
