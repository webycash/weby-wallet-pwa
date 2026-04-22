<script lang="ts">
	import { ArrowDownToLine, ArrowUpFromLine, X } from '@lucide/svelte';
	import InsertForm from './InsertForm.svelte';
	import PayForm from './PayForm.svelte';
	import PaymentResult from './PaymentResult.svelte';
	import type { NetworkMode } from '$lib/core/types';

	let { balanceWats, formatAmount, network, loading, message, messageType, copiedError,
		onInsert, onPay, paymentResult, paymentMemo, onDismissMessage, onCopyError, onClearPayment, isStandalone, isDesktop, onInstall }: {
		balanceWats: number;
		formatAmount: ((w: number) => string) | null;
		network: NetworkMode;
		loading: boolean;
		message: string;
		messageType: 'success' | 'error';
		copiedError: boolean;
		onInsert: (s: string) => void;
		onPay: (a: number, m: string) => void;
		paymentResult: string;
		paymentMemo: string;
		onDismissMessage: () => void;
		onCopyError: () => void;
		onClearPayment: () => void;
		isStandalone: boolean;
		isDesktop: boolean;
		onInstall?: () => void;
	} = $props();

	let activePanel = $state<string | null>(null);

	const WEBCASH_SYMBOL = '₩';
	let hidden = $state(false);
	let showUsd = $state(false);

	const RIG_HASHRATE_GHS = 14.5;
	const RIG_COST_PER_HOUR = 0.24;
	const MAX_SOLUTIONS_PER_HOUR = 600;
	const DIFFICULTY = 28;
	const MINING_AMOUNT = 195.3125;
	const estimateUsdPrice = (): number => {
		const hashes = Math.pow(2, DIFFICULTY);
		const hashrate_hps = RIG_HASHRATE_GHS * 1_000_000_000;
		const seconds_per_solution = hashes / hashrate_hps;
		const gpu_solutions_per_hour = 3600 / seconds_per_solution;
		const solutions_per_hour = Math.min(gpu_solutions_per_hour, MAX_SOLUTIONS_PER_HOUR);
		return RIG_COST_PER_HOUR / solutions_per_hour / MINING_AMOUNT;
	};
	const usdPrice = estimateUsdPrice();
	const fmtDisplay = (s: string): string => {
		if (!s.includes('.')) return s + '.00';
		const trimmed = s.replace(/0+$/, '');
		if (trimmed.endsWith('.')) return trimmed + '00';
		if (trimmed.split('.')[1].length === 1) return trimmed + '0';
		return trimmed;
	};
	const display = $derived(fmtDisplay(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8)));
	const usdValue = $derived((balanceWats / 1e8) * usdPrice);
	const usdDisplay = $derived(usdValue === 0 ? '$0.00' : usdValue < 0.01 ? `$${usdValue.toFixed(6)}` : `$${usdValue.toFixed(2)}`);
</script>

<div class="space-y-3 animate-fade-in">
	<!-- Balance inline (no card) -->
	<div class="py-6 md:py-10 text-center">
		<div class="flex justify-center gap-2 mb-4">
			<button onclick={() => showUsd = !showUsd}
				class="rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 {showUsd ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}">
				USD
			</button>
			<button onclick={() => hidden = !hidden}
				class="rounded-full p-1.5 text-muted-foreground hover:text-foreground transition-all duration-200">
				{#if hidden}<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878A3 3 0 0112 9c1.657 0 3 1.343 3 3a3 3 0 01-.878 2.121M15 12a3 3 0 01-3 3m0 0l6.878 6.878M21 21l-3.878-3.878"/></svg>{:else}<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>{/if}
			</button>
		</div>

		{#if network === 'testnet'}
			<p class="text-[10px] font-medium text-muted-foreground tracking-[0.2em] uppercase mb-3">Testnet</p>
		{/if}

		{#if hidden}
			<p class="text-5xl md:text-6xl font-light text-foreground tracking-tight">{WEBCASH_SYMBOL} ••••••</p>
		{:else if showUsd}
			<p class="text-5xl md:text-6xl font-light text-foreground tracking-tight tabular-nums">{usdDisplay}</p>
		{:else}
			<p class="text-5xl md:text-6xl font-light text-foreground tracking-tight tabular-nums">{WEBCASH_SYMBOL} {display}</p>
		{/if}
	</div>

	{#if message && messageType === 'success'}
		<div class="rounded-2xl px-4 py-3 text-sm font-medium bg-primary/8 text-primary text-center">
			{message}
		</div>
	{/if}

	<!-- Insert / Pay buttons -->
	<div class="grid grid-cols-2 gap-3 max-w-sm mx-auto w-full">
		<button
			class="h-12 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-sm font-medium transition-all duration-200 active:scale-[0.97]"
			onclick={() => (activePanel = 'insert')}
			disabled={loading}>
			<ArrowDownToLine class="w-[16px] h-[16px]" />
			Insert
		</button>
		<button
			class="h-12 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-sm font-medium transition-all duration-200 active:scale-[0.97]"
			onclick={() => (activePanel = 'pay')}
			disabled={loading}>
			<ArrowUpFromLine class="w-[16px] h-[16px]" />
			Pay
		</button>
	</div>

	<!-- Install App -->
	{#if paymentResult}
		<div class="animate-fade-in">
			<PaymentResult webcash={paymentResult} memo={paymentMemo} onDone={onClearPayment} />
		</div>
	{/if}
</div>

<!-- Insert Modal -->
{#if activePanel === 'insert'}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 bg-background/60 backdrop-blur-md" onclick={() => activePanel = null}></div>
	<div class="fixed inset-4 md:inset-x-auto md:inset-y-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md z-50 bg-background rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-in"
		role="dialog" aria-modal="true" aria-label="Insert webcash">
		<div class="flex items-center justify-between px-5 py-4">
			<h2 class="text-[15px] font-semibold">Insert Webcash</h2>
			<button onclick={() => activePanel = null}
				class="flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
				aria-label="Close">
				<X class="w-4 h-4" />
			</button>
		</div>
		<div class="flex-1 overflow-y-auto px-5 pb-5">
			<InsertForm onSubmit={(s) => { activePanel = null; onInsert(s); }} disabled={loading} />
		</div>
	</div>
{/if}

<!-- Pay Modal -->
{#if activePanel === 'pay'}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 bg-background/60 backdrop-blur-md" onclick={() => activePanel = null}></div>
	<div class="fixed inset-4 md:inset-x-auto md:inset-y-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md z-50 bg-background rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-in"
		role="dialog" aria-modal="true" aria-label="Pay webcash">
		<div class="flex items-center justify-between px-5 py-4">
			<h2 class="text-[15px] font-semibold">Pay Webcash</h2>
			<button onclick={() => activePanel = null}
				class="flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
				aria-label="Close">
				<X class="w-4 h-4" />
			</button>
		</div>
		<div class="flex-1 overflow-y-auto px-5 pb-5">
			<PayForm onSubmit={(a, m) => { activePanel = null; onPay(a, m); }} disabled={loading} formatAmount={formatAmount} {balanceWats} />
		</div>
	</div>
{/if}

<!-- Install App — bottom of page -->
{#if !isStandalone && onInstall}
	<div class="flex justify-center {isDesktop ? 'pt-10' : 'pt-16 pb-3'}">
		<button onclick={onInstall}
			class="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-muted/40 hover:bg-muted/60 text-[13px] font-medium text-foreground transition-all duration-200 active:scale-[0.97]">
			<img src="/favicon-96x96.png" alt="" class="w-7 h-7 rounded-full" />
			Install App
		</button>
	</div>
{/if}
