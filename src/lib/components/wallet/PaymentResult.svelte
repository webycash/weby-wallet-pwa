<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, Check, Mail, Share2, X, QrCode } from '@lucide/svelte';
	import { getNetwork } from '$lib/stores/network.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';

	let { webcash, memo = '', onDone }: { webcash: string; memo?: string; onDone: () => void } = $props();

	let copied = $state(false);
	let qrDataUrl = $state('');
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

	const copyWebcash = async () => { await navigator.clipboard.writeText(webcash); copied = true; setTimeout(() => { copied = false; }, 2000); };
	const copyLink = async () => { await navigator.clipboard.writeText(walletUrl); copied = true; setTimeout(() => { copied = false; }, 2000); };
	const shareWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank'); };
	const shareEmail = () => { window.open(`mailto:?subject=${encodeURIComponent('Webcash Payment')}&body=${encodeURIComponent(shareText)}`, '_blank'); };
	const shareNative = async () => { if (navigator.share) await navigator.share({ title: 'Webcash Payment', text: shareText, url: walletUrl }); };
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	onMount(async () => {
		try {
			const QRCode = (await import('qrcode')).default;
			qrDataUrl = await QRCode.toDataURL(walletUrl, { width: 200, margin: 2, color: { dark: '#000', light: '#fff' } });
		} catch {}
	});
</script>

<Card.Root class="border-success">
	<Card.Content class="p-6 space-y-5">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<div class="w-8 h-8 rounded-full bg-success flex items-center justify-center">
					<Check class="w-4 h-4" />
				</div>
				<h3 class="text-sm font-semibold text-foreground">Payment Sent</h3>
			</div>
			<button onclick={onDone} class="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
				<X class="w-4 h-4" />
			</button>
		</div>

		<!-- Memo -->
		{#if memo}
			<div class="rounded-2xl bg-muted border border-border px-4 py-3 text-center">
				<p class="text-sm text-foreground italic">"{memo}"</p>
			</div>
		{/if}

		<!-- Webcash secret -->
		<div>
			<p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Send this to the recipient</p>
			<div class="rounded-2xl bg-muted border border-border p-4">
				<code class="text-xs font-mono text-foreground break-all leading-relaxed select-all">{webcash}</code>
			</div>
		</div>

		<!-- QR Code -->
		{#if qrDataUrl}
			<div class="text-center">
				<p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Or scan to receive</p>
				<div class="inline-block bg-white rounded-2xl p-3">
					<img src={qrDataUrl} alt="Payment QR" class="w-40 h-40" />
				</div>
			</div>
		{/if}

		<!-- Action buttons -->
		<div class="grid grid-cols-2 gap-2">
			<Button variant="outline" onclick={copyWebcash}>
				{#if copied}
					<Check class="w-4 h-4 text-success" /> Copied
				{:else}
					<Copy class="w-4 h-4" /> Copy Secret
				{/if}
			</Button>
			<Button variant="outline" onclick={copyLink}>
				<QrCode class="w-4 h-4" /> Copy Link
			</Button>
		</div>

		<!-- Share buttons -->
		<div class="grid grid-cols-2 gap-2">
			<Button class="bg-[#25D366] text-white border-[#25D366] hover:opacity-90" onclick={shareWhatsApp}>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.624-1.467A11.932 11.932 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-2.168 0-4.19-.593-5.93-1.626l-.425-.253-2.74.87.884-2.678-.277-.44A9.77 9.77 0 012.182 12c0-5.414 4.404-9.818 9.818-9.818S21.818 6.586 21.818 12s-4.404 9.818-9.818 9.818z"/></svg>
				WhatsApp
			</Button>
			<Button variant="outline" onclick={shareEmail}>
				<Mail class="w-4 h-4" /> Email
			</Button>
		</div>

		{#if canShare}
			<Button class="w-full" onclick={shareNative}>
				<Share2 class="w-4 h-4" /> Share via...
			</Button>
		{/if}

		<p class="text-[10px] text-muted-foreground text-center">
			The recipient can open the link to instantly add this webcash to their wallet
		</p>
	</Card.Content>
</Card.Root>
