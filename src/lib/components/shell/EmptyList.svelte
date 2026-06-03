<script lang="ts">
	// Honest empty-list state for the list-default views (RGB Assets, Voucher
	// Vouchers, History). There is no faked data: until extro-node exposes a
	// listing command for these families, the truthful state is "nothing here
	// yet". Distinct from ComingSoon (which gates an OPERATION) — this gates
	// DATA we can't yet enumerate.
	import type { Component } from 'svelte';

	let { icon, title }: { icon: Component; title: string } = $props();
	const Icon = $derived(icon);
</script>

<div class="animate-fade-in max-w-sm mx-auto w-full pt-8">
	<div class="rounded-3xl bg-muted/40 px-6 py-14 text-center">
		<div class="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-5">
			<Icon class="w-7 h-7 text-muted-foreground" />
		</div>
		<h3 class="text-[17px] font-medium text-foreground mb-2">{title}</h3>
		<p class="text-[13px] text-muted-foreground leading-relaxed">
			None yet — listing arrives with extro-node.
		</p>
	</div>
</div>
