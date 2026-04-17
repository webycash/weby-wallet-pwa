<script lang="ts">
	import { ArrowUpFromLine } from '@lucide/svelte';
	let { onSubmit, disabled, formatAmount, balanceWats }: {
		onSubmit: (amountWats: number, memo: string) => void;
		disabled: boolean;
		formatAmount: ((w: number) => string) | null;
		balanceWats: number;
	} = $props();

	let amountStr = $state('');
	let memo = $state('');

	const submit = () => {
		const parsed = parseFloat(amountStr);
		if (isNaN(parsed) || parsed <= 0) return;
		const wats = Math.round(parsed * 1e8);
		onSubmit(wats, memo);
		amountStr = '';
		memo = '';
	};

	const setMax = () => {
		amountStr = formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8);
	};

	const maxDisplay = $derived(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8));
</script>

<div class="rounded-3xl border-2 border-border bg-card p-5 space-y-3">
	<div>
		<div class="flex items-center justify-between mb-1.5">
			<label class="text-xs font-medium text-muted-foreground" for="pay-amount">Amount</label>
			<button onclick={setMax} class="text-[11px] text-primary hover:underline font-medium">Max: {maxDisplay}</button>
		</div>
		<input
			id="pay-amount"
			type="number"
			step="0.00000001"
			min="0"
			bind:value={amountStr}
			placeholder="0.00"
			class="w-full rounded-xl border-2 border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
		/>
	</div>
	<input
		type="text"
		bind:value={memo}
		placeholder="Memo (optional)"
		class="w-full rounded-xl border-2 border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
	/>
	<button onclick={submit}
		class="w-full flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
		disabled={disabled || !amountStr}>
		<ArrowUpFromLine class="w-4 h-4" />
		Send
	</button>
</div>
