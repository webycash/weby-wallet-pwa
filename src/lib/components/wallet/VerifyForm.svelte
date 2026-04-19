<script lang="ts">
	import { getNetwork } from '$lib/stores/network.svelte';
	import { getWasm } from '$lib/core/wasm';
	import { ShieldCheck } from '@lucide/svelte';
	import Spinner from '$lib/components/ui/spinner.svelte';

	let input = $state('');
	let result = $state<'valid' | 'spent' | 'unknown' | null>(null);
	let loading = $state(false);
	let error = $state('');

	const verify = async () => {
		const trimmed = input.trim();
		if (!trimmed) return;
		loading = true;
		error = '';
		result = null;
		try {
			const wasm = await getWasm();
			const responseJson = await wasm.verify_webcash(getNetwork(), trimmed);
			const response = JSON.parse(responseJson);
			if (response.spent === true) result = 'spent';
			else if (response.spent === false) result = 'valid';
			else result = 'unknown';
		} catch (e: any) {
			error = e.message || 'Verification failed';
		}
		loading = false;
	};
</script>

<div class="rounded-3xl border border-border bg-card p-5 space-y-3">
	<label class="text-xs font-medium text-muted-foreground" for="verify-input">
		Paste public or secret webcash to verify
	</label>
	<textarea
		id="verify-input"
		bind:value={input}
		placeholder="e1.5:public:abc123... or e1.5:secret:abc123..."
		class="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm font-mono h-16 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
		spellcheck="false"
	></textarea>
	<button onclick={verify}
		class="w-full flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
		disabled={loading || !input.trim()}>
		{#if loading}
			<Spinner size="sm" />
		{:else}
			<ShieldCheck class="w-4 h-4" />
		{/if}
		{loading ? 'Checking...' : 'Verify'}
	</button>

	{#if result === 'valid'}
		<div class="rounded-2xl bg-success border border-success px-4 py-3 text-sm text-success-foreground dark:text-success-foreground font-medium">
			Valid -- this webcash is unspent
		</div>
	{:else if result === 'spent'}
		<div class="rounded-2xl bg-danger border border-danger px-4 py-3 text-sm text-danger-foreground dark:text-danger-foreground font-medium">
			Spent -- this webcash has already been used
		</div>
	{:else if result === 'unknown'}
		<div class="rounded-2xl bg-warning border border-warning px-4 py-3 text-sm text-warning-foreground dark:text-warning-foreground font-medium">
			Unknown -- not found on the server
		</div>
	{/if}

	{#if error}
		<div class="rounded-2xl bg-danger border border-danger px-4 py-3 text-sm text-danger-foreground">{error}</div>
	{/if}
</div>
