<script lang="ts">
	import { getNetwork } from '$lib/stores/network.svelte';
	import { healthCheck } from '$lib/core/server';
	import { ShieldCheck } from '@lucide/svelte';

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
			const response = await healthCheck(getNetwork(), [trimmed]);
			const entries = Object.values(response.results ?? {});
			if (entries.length > 0) {
				const r = entries[0];
				if (r.spent === true) result = 'spent';
				else if (r.spent === false) result = 'valid';
				else result = 'unknown';
			} else {
				result = 'unknown';
			}
		} catch (e: any) {
			error = e.message || 'Verification failed';
		}
		loading = false;
	};
</script>

<div class="rounded-3xl border-2 border-border bg-card p-5 space-y-3">
	<label class="text-xs font-medium text-muted-foreground" for="verify-input">
		Paste public or secret webcash to verify
	</label>
	<textarea
		id="verify-input"
		bind:value={input}
		placeholder="e1.5:public:abc123... or e1.5:secret:abc123..."
		class="w-full rounded-2xl border-2 border-input bg-background px-4 py-3 text-sm font-mono h-16 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
		spellcheck="false"
	></textarea>
	<button onclick={verify}
		class="w-full flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
		disabled={loading || !input.trim()}>
		<ShieldCheck class="w-4 h-4" />
		{loading ? 'Checking...' : 'Verify'}
	</button>

	{#if result === 'valid'}
		<div class="rounded-2xl bg-emerald-500 border-2 border-emerald-500 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
			Valid — this webcash is unspent
		</div>
	{:else if result === 'spent'}
		<div class="rounded-2xl bg-red-500 border-2 border-red-500 px-4 py-3 text-sm text-red-600 dark:text-red-400 font-medium">
			Spent — this webcash has already been used
		</div>
	{:else if result === 'unknown'}
		<div class="rounded-2xl bg-amber-500 border-2 border-amber-500 px-4 py-3 text-sm text-amber-600 dark:text-amber-400 font-medium">
			Unknown — not found on the server
		</div>
	{/if}

	{#if error}
		<div class="rounded-2xl bg-red-500 border-2 border-red-500 px-4 py-3 text-sm text-red-500">{error}</div>
	{/if}
</div>
