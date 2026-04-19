<script lang="ts">
	import { ArrowDownToLine } from '@lucide/svelte';
	let { onSubmit, disabled }: { onSubmit: (s: string) => void; disabled: boolean } = $props();
	let input = $state('');

	const submit = () => {
		if (input.trim()) { onSubmit(input.trim()); input = ''; }
	};
</script>

<div class="rounded-2xl border border-border bg-card p-5">
	<label class="text-xs font-medium text-muted-foreground" for="insert-input">Paste webcash to receive</label>
	<textarea
		id="insert-input"
		bind:value={input}
		placeholder="e0.001:secret:abc123..."
		class="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-mono h-20 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
		spellcheck="false"
	></textarea>
	<button onclick={submit}
		class="mt-3 w-full flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
		disabled={disabled || !input.trim()}>
		<ArrowDownToLine class="w-4 h-4" />
		Insert
	</button>
</div>
