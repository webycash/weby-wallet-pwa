<script lang="ts">
	import { Copy, Check, Share2, X, QrCode } from '@lucide/svelte';
	import { getNetwork } from '$lib/stores/network.svelte';
	import { secretToPublic, parseAmount, formatPublicWebcash } from '$lib/stores/wallet.svelte';
	import Button from '$lib/components/ui/button/button.svelte';

	let { webcash, memo = '', onDone }: { webcash: string; memo?: string; onDone: () => void } = $props();

	let copied = $state(false);
	let copiedLink = $state(false);
	let displayAmount = $state('');
	let publicWc = $state('');
	let showQr = $state(false);
	let qrDataUrl = $state('');

	const network = getNetwork();

	$effect(() => {
		try {
			const match = webcash.match(/^e([^:]+):secret:([0-9a-fA-F]{64})$/);
			if (match) {
				displayAmount = match[1];
				(async () => {
					const hash = await secretToPublic(match[2]);
					const wats = await parseAmount(match[1]);
					publicWc = await formatPublicWebcash(hash, wats);
				})().catch(() => {});
			}
		} catch {}
	});

	const walletUrl = $derived(
		`https://weby.cash/wallet?webcash=${encodeURIComponent(webcash)}&network=${network}&amount=${encodeURIComponent(displayAmount)}${memo ? `&memo=${encodeURIComponent(memo)}` : ''}${publicWc ? `&pub=${encodeURIComponent(publicWc)}` : ''}`
	);

	const truncated = $derived(webcash.length > 32 ? webcash.slice(0, 16) + '...' + webcash.slice(-12) : webcash);

	// Pre-warm OG image at edge cache so it's instant when recipient's app fetches it
	const ogUrl = $derived(`https://weby.cash/wallet/og-card.png?amount=${encodeURIComponent(displayAmount)}${memo ? '&memo=' + encodeURIComponent(memo) : ''}`);
	$effect(() => { if (displayAmount) fetch(ogUrl, { mode: 'no-cors' }).catch(() => {}); });

	const copyWebcash = async () => { await navigator.clipboard.writeText(webcash); copied = true; setTimeout(() => { copied = false; }, 2000); };
	const copyLink = async () => { await navigator.clipboard.writeText(walletUrl); copiedLink = true; setTimeout(() => { copiedLink = false; }, 2000); };
	const shareNative = async () => { if (navigator.share) await navigator.share({ url: walletUrl }); };
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';


	const openQr = async () => {
		const QR = (await import('qrcode')).default;
		qrDataUrl = await QR.toDataURL(walletUrl, { width: 512, margin: 2, color: { dark: '#000', light: '#fff' } });
		showQr = true;
	};

	const shareQr = async () => {
		if (!qrDataUrl) return;
		try {
			const res = await fetch(qrDataUrl);
			const blob = await res.blob();
			const file = new File([blob], 'webcash-qr.png', { type: 'image/png' });
			await navigator.share({ files: [file], title: `₩${displayAmount} webcash` });
		} catch {
			await navigator.clipboard.writeText(walletUrl);
		}
	};
</script>

<div class="max-w-sm mx-auto space-y-5 text-center">
	<div class="flex items-center justify-center gap-2.5">
		<div class="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
			<Check class="w-4 h-4 text-primary" />
		</div>
		<p class="text-[15px] text-muted-foreground">Sent <span class="font-semibold text-foreground">₩{displayAmount}</span></p>
	</div>

	{#if memo}
		<p class="text-[14px] text-muted-foreground italic">"{memo}"</p>
	{/if}

	<div>
		<p class="text-[13px] text-muted-foreground mb-2">Send this to the recipient</p>
		<button class="text-[15px] font-mono font-semibold text-foreground tracking-tight select-all cursor-pointer" onclick={copyWebcash}>{truncated}</button>
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

	<div class="grid grid-cols-2 gap-2">
		<Button variant="outline" onclick={openQr}>
			<QrCode class="w-4 h-4" /> Show QR
		</Button>
		{#if canShare}
			<Button variant="outline" onclick={shareNative}>
				<Share2 class="w-4 h-4" /> Share via...
			</Button>
		{/if}
	</div>

	<p class="text-[12px] text-muted-foreground">
		The recipient can open the link to instantly claim this webcash
	</p>

	<button onclick={onDone}
		class="text-[13px] text-muted-foreground hover:text-foreground transition-all duration-200">
		Done
	</button>
</div>

{#if showQr}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex flex-col items-center justify-center px-5 animate-fade-in">
		<div class="absolute inset-0 bg-background/60 backdrop-blur-md" onclick={() => showQr = false}></div>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="relative max-w-sm w-full animate-scale-in" onclick={(e) => e.stopPropagation()}>
			<button onclick={() => showQr = false}
				class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200 mb-4 ml-auto"
				aria-label="Close">
				<X class="w-7 h-7" />
			</button>
			{#if qrDataUrl}
				<img src={qrDataUrl} alt="QR Code" class="w-full rounded-2xl" />
			{/if}
			{#if canShare}
				<Button class="w-full mt-4" onclick={shareQr}>
					<Share2 class="w-4 h-4" /> Share QR
				</Button>
			{/if}
		</div>
	</div>
{/if}
