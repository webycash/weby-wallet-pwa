<script lang="ts">
	import { Copy, Check, Share2, X } from '@lucide/svelte';
	import { getNetwork } from '$lib/stores/network.svelte';
	import Button from '$lib/components/ui/button/button.svelte';

	let { webcash, memo = '', onDone }: { webcash: string; memo?: string; onDone: () => void } = $props();

	let copied = $state(false);
	let copiedLink = $state(false);
	let displayAmount = $state('');

	const network = getNetwork();

	$effect(() => {
		try {
			const match = webcash.match(/^e([^:]+):secret:/);
			if (match) displayAmount = match[1];
		} catch {}
	});

	const walletUrl = $derived(
		`https://weby.cash/wallet?webcash=${encodeURIComponent(webcash)}&network=${network}&amount=${encodeURIComponent(displayAmount)}${memo ? `&memo=${encodeURIComponent(memo)}` : ''}`
	);
	const shareText = $derived(
		`You received ₩${displayAmount} webcash!${memo ? `\n\n"${memo}"` : ''}\n\nOpen to claim: ${walletUrl}`
	);

	const truncated = $derived(webcash.length > 32 ? webcash.slice(0, 16) + '...' + webcash.slice(-12) : webcash);

	const copyWebcash = async () => { await navigator.clipboard.writeText(webcash); copied = true; setTimeout(() => { copied = false; }, 2000); };
	const copyLink = async () => { await navigator.clipboard.writeText(walletUrl); copiedLink = true; setTimeout(() => { copiedLink = false; }, 2000); };
	const shareNative = async () => { if (navigator.share) await navigator.share({ title: 'Webcash Payment', text: shareText, url: walletUrl }); };
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
</script>

<div class="space-y-5">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<div class="w-6 h-6 rounded-full bg-success flex items-center justify-center">
				<Check class="w-3 h-3" />
			</div>
			<p class="text-sm text-muted-foreground">Sent <span class="font-semibold text-foreground">₩{displayAmount}</span></p>
		</div>
		<button onclick={onDone} class="text-muted-foreground hover:text-foreground transition-all">
			<X class="w-4 h-4" />
		</button>
	</div>

	{#if memo}
		<p class="text-sm text-muted-foreground italic">"{memo}"</p>
	{/if}

	<div>
		<p class="text-xs text-muted-foreground mb-2">Send this to the recipient</p>
		<code class="text-lg font-mono font-semibold text-foreground tracking-tight select-all cursor-pointer" onclick={copyWebcash}>{truncated}</code>
	</div>

	<div class="grid grid-cols-2 gap-2">
		<Button variant="outline" onclick={copyWebcash}>
			{#if copied}
				<Check class="w-4 h-4 text-success" /> Copied
			{:else}
				<Copy class="w-4 h-4" /> Copy Secret
			{/if}
		</Button>
		<Button variant="outline" onclick={copyLink}>
			{#if copiedLink}
				<Check class="w-4 h-4 text-success" /> Copied
			{:else}
				<Copy class="w-4 h-4" /> Copy Link
			{/if}
		</Button>
	</div>

	{#if canShare}
		<Button class="w-full" onclick={shareNative}>
			<Share2 class="w-4 h-4" /> Share via...
		</Button>
	{/if}

	<p class="text-xs text-muted-foreground text-center">
		The recipient can open the link to instantly claim this webcash
	</p>
</div>
