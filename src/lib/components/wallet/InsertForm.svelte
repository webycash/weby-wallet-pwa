<script lang="ts">
	let { onSubmit, disabled }: { onSubmit: (s: string) => void; disabled: boolean } = $props();
	let input = $state('');

	const submit = () => {
		if (input.trim()) { onSubmit(input.trim()); input = ''; }
	};
</script>

<div class="rounded-xl border border-border bg-card p-4">
	<label class="text-xs font-medium text-muted-foreground" for="insert-input">
		Paste webcash string
	</label>
	<textarea
		id="insert-input"
		bind:value={input}
		placeholder="e0.001:secret:abc123..."
		class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono h-16 resize-none"
		spellcheck="false"
	></textarea>
	<button onclick={submit}
		class="mt-2 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
		disabled={disabled || !input.trim()}>
		Insert
	</button>
</div>
