<script lang="ts">
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

	const maxDisplay = $derived(formatAmount ? formatAmount(balanceWats) : (balanceWats / 1e8).toFixed(8));
</script>

<div class="rounded-xl border border-border bg-card p-4">
	<label class="text-xs font-medium text-muted-foreground" for="pay-amount">Amount</label>
	<div class="mt-1 relative">
		<input
			id="pay-amount"
			type="number"
			step="0.00000001"
			min="0"
			bind:value={amountStr}
			placeholder="0.00"
			class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
		/>
		<span class="absolute right-3 top-2 text-xs text-muted-foreground">max: {maxDisplay}</span>
	</div>
	<input
		type="text"
		bind:value={memo}
		placeholder="Memo (optional)"
		class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
	/>
	<button onclick={submit}
		class="mt-2 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
		disabled={disabled || !amountStr}>
		Pay
	</button>
</div>
