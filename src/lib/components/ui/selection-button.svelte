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
		"w-full flex items-center gap-3 rounded-full px-5 py-4 text-left transition-all duration-200",
		selected
			? "bg-primary text-primary-foreground"
			: "bg-muted/50 text-foreground hover:bg-muted/80",
		disabled && "opacity-50 cursor-not-allowed",
		className
	)}>
	{@render children()}
	{#if selected}
		<div class="w-2 h-2 rounded-full bg-primary-foreground shrink-0 ml-auto"></div>
	{/if}
</button>
