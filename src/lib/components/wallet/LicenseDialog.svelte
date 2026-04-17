<script lang="ts">
	import { acceptLicense } from '$lib/stores/settings.svelte';
	import { Gift } from '@lucide/svelte';

	let { onAccepted, hasGift = false, giftAmount = '' }: {
		onAccepted?: () => void;
		hasGift?: boolean;
		giftAmount?: string;
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

<div class="container mx-auto px-4 py-8 max-w-lg">
	<!-- Gift banner if receiving -->
	{#if hasGift}
		<div class="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 text-center mb-6">
			<div class="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
				<Gift class="w-6 h-6 text-primary" />
			</div>
			<p class="text-sm text-muted-foreground mb-1">Someone sent you</p>
			<p class="text-3xl font-bold text-foreground">₩{giftAmount || '?'}</p>
			<p class="text-xs text-muted-foreground/60 mt-2">Accept the terms below to claim it</p>
		</div>
	{/if}

	<div class="rounded-3xl border border-border bg-card p-6 space-y-5">
		<div>
			<h2 class="text-lg font-bold text-foreground mb-1">Terms of Service</h2>
			<p class="text-xs text-muted-foreground">
				Accept both the Webcash Terms of Service and the MIT License.
			</p>
		</div>

		<div class="rounded-2xl border border-border bg-muted/30 p-4">
			<h3 class="text-xs font-semibold text-foreground mb-2">Webcash Terms of Service</h3>
			<a
				href="https://webcash.org/terms"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 underline transition-colors"
			>
				Read at webcash.org/terms
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-6H21m0 0v7.5m0-7.5l-9 9" />
				</svg>
			</a>
		</div>

		<div class="rounded-2xl border border-border bg-muted/30 p-4">
			<h3 class="text-xs font-semibold text-foreground mb-2">Weby Wallet License (MIT)</h3>
			<pre class="text-[10px] text-muted-foreground overflow-auto max-h-32 whitespace-pre-wrap leading-relaxed">MIT License — Copyright (c) 2026 Webycash

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.</pre>
		</div>

		<label class="flex items-start gap-3 cursor-pointer">
			<input type="checkbox" bind:checked={tosChecked} class="mt-0.5 h-4 w-4 rounded border-border accent-primary" />
			<span class="text-xs text-foreground">
				I accept the
				<a href="https://webcash.org/terms" target="_blank" rel="noopener noreferrer" class="text-primary underline">Webcash Terms</a>
				and the MIT License
			</span>
		</label>

		<button
			onclick={accept}
			disabled={!tosChecked}
			class="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all
				{tosChecked ? 'hover:bg-primary/90' : 'opacity-50 cursor-not-allowed'}"
		>
			{hasGift ? 'Accept & Claim Webcash' : 'Accept & Continue'}
		</button>
	</div>
</div>
