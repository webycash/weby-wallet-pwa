<script lang="ts">
	import { acceptLicense } from '$lib/stores/settings.svelte';
	import { Gift } from '@lucide/svelte';

	let { onAccepted, hasGift = false, giftAmount = '', giftMemo = '' }: {
		onAccepted?: () => void;
		hasGift?: boolean;
		giftAmount?: string;
		giftMemo?: string;
	} = $props();

	let tosChecked = $state(false);

	const accept = () => {
		if (!tosChecked) return;
		acceptLicense();
		if (onAccepted) {
			onAccepted();
		} else {
			window.location.reload();
		}
	};
</script>

<div class="container mx-auto px-4 py-12 max-w-sm">
	{#if hasGift}
		<div class="rounded-3xl border border-primary bg-gradient-to-br from-primary via-primary to-transparent p-6 text-center mb-8">
			<Gift class="w-8 h-8 text-primary mx-auto mb-3" />
			<p class="text-sm text-muted-foreground mb-1">Someone sent you</p>
			<p class="text-3xl font-bold text-foreground">₩{giftAmount || '?'}</p>
			{#if giftMemo}<p class="text-sm text-muted-foreground mt-2 italic">"{giftMemo}"</p>{/if}
		</div>
	{/if}

	<div class="space-y-6">
		<div>
			<h2 class="text-lg font-bold text-foreground">Terms of Service</h2>
			<p class="text-sm text-muted-foreground mt-1">
				By using this wallet you agree to the
				<a href="https://webcash.org/terms" target="_blank" rel="noopener noreferrer" class="text-primary underline">Webcash Terms of Service</a>.
			</p>
		</div>

		<label class="flex items-center gap-3 cursor-pointer">
			<input type="checkbox" bind:checked={tosChecked} class="h-4 w-4 rounded border-border accent-primary" />
			<span class="text-sm text-foreground">I accept the terms</span>
		</label>

		<button
			onclick={accept}
			disabled={!tosChecked}
			class="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all
				{tosChecked ? 'hover:opacity-90' : 'opacity-50 cursor-not-allowed'}"
		>
			{hasGift ? 'Accept & Claim' : 'Continue'}
		</button>
	</div>
</div>
