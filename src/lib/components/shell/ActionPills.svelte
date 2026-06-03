<script lang="ts">
	// 2-col pill action row — the DashboardView Insert/Pay buttons generalised to
	// data. Each action is `{ label, icon, view }`; clicking navigates to that
	// view within the active tab (menu-as-data, no per-family branching).
	import type { Component } from 'svelte';
	import { selectView } from '$lib/stores/navigation.svelte';

	let { actions }: {
		actions: readonly { label: string; icon: Component; view: string }[];
	} = $props();
</script>

<div class="grid grid-cols-2 gap-3 max-w-sm mx-auto w-full">
	{#each actions as action}
		{@const Icon = action.icon}
		<button
			class="h-14 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-[15px] font-medium transition-all duration-200 active:scale-[0.97]"
			onclick={() => selectView(action.view)}>
			<Icon class="w-[18px] h-[18px]" />
			{action.label}
		</button>
	{/each}
</div>
