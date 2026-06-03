<script lang="ts">
	// Honest "coming via extro-node" state. Rendered for any value-moving view
	// whose extro-node command does not exist yet (Send / Issue / Transfer /
	// Redeem / ARK lock-exit / per-asset history). It is a clean DISABLED card —
	// never a fake form that pretends to submit. The coordinator extends
	// extro-node's command surface next; these shells then wire to it.
	import type { Component } from 'svelte';

	let { icon, title, detail }: {
		icon: Component;
		title: string;
		detail?: string;
	} = $props();
	const Icon = $derived(icon);
</script>

<div class="animate-fade-in max-w-sm mx-auto w-full pt-4">
	<div class="rounded-3xl bg-muted/40 px-6 py-12 text-center">
		<div class="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-5">
			<Icon class="w-7 h-7 text-muted-foreground" />
		</div>
		<h3 class="text-[19px] font-medium text-foreground mb-2">{title}</h3>
		<p class="text-[13px] text-muted-foreground leading-relaxed mb-5">
			{detail ?? 'This operation arrives with the extro-node command surface.'}
		</p>
		<span class="inline-block rounded-full bg-background px-4 py-1.5 text-[11px] font-medium text-muted-foreground tracking-wide">
			Coming via extro-node · Testnet
		</span>
	</div>
</div>
