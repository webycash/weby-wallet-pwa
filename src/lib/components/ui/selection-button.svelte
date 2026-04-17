<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		selected = false,
		disabled = false,
		onclick,
		class: className,
		children
	}: {
		selected?: boolean;
		disabled?: boolean;
		onclick?: () => void;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<button
	{onclick}
	{disabled}
	class={cn(
		"w-full flex items-center gap-3 rounded-full border-2 px-5 py-4 text-left transition-all",
		selected
			? "border-primary bg-primary text-primary-foreground"
			: "border-border bg-card text-foreground hover:border-primary hover:bg-muted",
		disabled && "opacity-50 cursor-not-allowed",
		className
	)}>
	{@render children()}
	{#if selected}
		<div class="w-2 h-2 rounded-full bg-primary-foreground shrink-0 ml-auto"></div>
	{/if}
</button>
