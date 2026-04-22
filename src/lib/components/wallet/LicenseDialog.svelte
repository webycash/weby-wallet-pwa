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

<div class="min-h-[100dvh] flex items-center justify-center px-6">
	<div class="w-full max-w-sm space-y-8">
		{#if hasGift}
			<div class="text-center">
				<Gift class="w-10 h-10 text-primary mx-auto mb-4 opacity-60" />
				<p class="text-[13px] text-muted-foreground mb-2">Someone sent you</p>
				<p class="text-4xl font-light text-foreground tracking-tight">₩{giftAmount || '?'}</p>
				{#if giftMemo}<p class="text-[13px] text-muted-foreground mt-3 italic">"{giftMemo}"</p>{/if}
			</div>
		{/if}

		<div class="text-center">
			<h2 class="text-2xl font-light text-foreground tracking-tight mb-3">Terms of Service</h2>
			<p class="text-[13px] text-muted-foreground leading-relaxed">
				By using this wallet you agree to the
				<a href="https://webcash.org/terms" target="_blank" rel="noopener noreferrer" class="text-primary hover:opacity-80 transition-opacity">Webcash Terms of Service</a>.
			</p>
		</div>

		<label class="flex items-center justify-center gap-3 cursor-pointer">
			<input type="checkbox" bind:checked={tosChecked} class="h-4 w-4 rounded accent-primary" />
			<span class="text-[13px] text-foreground">I accept the terms</span>
		</label>

		<button
			onclick={accept}
			disabled={!tosChecked}
			class="w-full rounded-full bg-primary px-4 py-3.5 text-[14px] font-medium text-primary-foreground transition-all duration-200 active:scale-[0.97]
				{tosChecked ? 'hover:opacity-90' : 'opacity-30 cursor-not-allowed'}"
		>
			{hasGift ? 'Accept & Claim' : 'Continue'}
		</button>
	</div>
</div>
