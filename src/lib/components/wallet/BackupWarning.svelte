<script lang="ts">
	import { dismissBackup, backupDismissed } from '$lib/stores/settings.svelte';

	let dismissed = $state(backupDismissed());

	const dismiss = () => {
		dismissBackup();
		dismissed = true;
	};
</script>

{#if !dismissed}
	<div class="bg-warning/10 border-b border-warning/20 px-4 py-2">
		<div class="container mx-auto max-w-2xl flex items-center justify-between text-xs">
			<span class="text-warning font-medium">
				Wallet not backed up.
				<a href="#backup" class="underline hover:no-underline ml-1">Back up now</a>
			</span>
			<button onclick={dismiss} class="text-warning/60 hover:text-warning p-1" aria-label="Dismiss">
				&times;
			</button>
		</div>
	</div>
{/if}
