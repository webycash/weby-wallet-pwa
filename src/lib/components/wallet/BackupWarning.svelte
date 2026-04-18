<script lang="ts">
	import { dismissBackup, backupDismissed } from '$lib/stores/settings.svelte';

	let dismissed = $state(backupDismissed());

	const dismiss = () => {
		dismissBackup();
		dismissed = true;
	};
</script>

{#if !dismissed}
	<div class="bg-muted border-b border-border px-4 py-2">
		<div class="container mx-auto max-w-2xl flex items-center justify-between text-xs">
			<span class="text-muted-foreground font-medium">
				Not backed up
				<a href="#backup" class="underline hover:no-underline ml-1 text-foreground">Back up now</a>
			</span>
			<button onclick={dismiss} class="text-muted-foreground hover:text-foreground p-1" aria-label="Dismiss">
				&times;
			</button>
		</div>
	</div>
{/if}
