<script lang="ts">
	import type { NetworkMode } from '$lib/core/types';
	import { Gift, CheckCircle, AlertCircle, Loader2 } from '@lucide/svelte';

	let { amount, memo = '', network, success, error, onContinue }: {
		amount: string;
		memo?: string;
		network: NetworkMode;
		success: boolean;
		error: string;
		onContinue: () => void;
	} = $props();

	const WEBCASH_SYMBOL = '₩';
	const displayAmount = $derived(amount || '?');
</script>

<div class="min-h-[60vh] flex items-center justify-center px-4 py-12">
	<div class="w-full max-w-sm">
		<!-- Gift Card -->
		<div class="relative overflow-hidden rounded-3xl border-2 border-primary bg-gradient-to-br from-primary via-primary to-transparent p-8 text-center">
			<!-- Decorative circles -->
			<div class="absolute top-0 left-0 w-24 h-24 bg-primary rounded-full -translate-x-1/2 -translate-y-1/2 blur-xl"></div>
			<div class="absolute bottom-0 right-0 w-32 h-32 bg-primary rounded-full translate-x-1/3 translate-y-1/3 blur-2xl"></div>
			<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-primary rounded-full blur-3xl"></div>

			<div class="relative">
				{#if success}
					<!-- Success state -->
					<div class="w-16 h-16 rounded-full bg-success flex items-center justify-center mx-auto mb-4">
						<CheckCircle class="w-8 h-8 text-success" />
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
						<span class="inline-block mt-3 rounded-full bg-warning border-2 border-warning px-3 py-1 text-xs font-medium text-warning-foreground">Testnet</span>
					{/if}

				{:else if error}
					<!-- Error state -->
					<div class="w-16 h-16 rounded-full bg-danger flex items-center justify-center mx-auto mb-4">
						<AlertCircle class="w-8 h-8 text-danger-foreground" />
					</div>
					<p class="text-xs font-medium text-danger-foreground uppercase tracking-widest mb-3">Failed</p>
					<p class="text-5xl font-bold text-foreground tracking-tight tabular-nums mb-2">
						{WEBCASH_SYMBOL}{displayAmount}
					</p>
					{#if memo}<p class="text-sm text-muted-foreground mt-2 italic">"{memo}"</p>{/if}
					<p class="text-sm text-danger-foreground mt-3">{error}</p>

				{:else}
					<!-- Loading state -->
					<div class="w-16 h-16 rounded-full bg-primary flex items-center justify-center mx-auto mb-4">
						<Loader2 class="w-8 h-8 text-primary animate-spin" />
					</div>
					<p class="text-xs font-medium text-primary uppercase tracking-widest mb-3">Receiving</p>
					<p class="text-5xl font-bold text-foreground tracking-tight tabular-nums mb-2">
						{WEBCASH_SYMBOL}{displayAmount}
					</p>
					{#if memo}<p class="text-sm text-muted-foreground mt-2 italic">"{memo}"</p>{/if}
					<p class="text-sm text-muted-foreground mt-2">Setting up your wallet...</p>
				{/if}
			</div>
		</div>

		<!-- Bottom text -->
		<p class="text-center text-[11px] text-muted-foreground mt-4">
			You received Webcash
		</p>

		<!-- Continue button -->
		{#if success || error}
			<button onclick={onContinue}
				class="mt-6 w-full flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all">
				{success ? 'Open Wallet' : 'Try Again'}
			</button>
		{/if}
	</div>
</div>
