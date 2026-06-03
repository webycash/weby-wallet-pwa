<script lang="ts">
	// Receive-address card. Derives the family address live via the extro facade
	// (`DeriveFamilyHandle`) on mount, then shows it with copy. This is a LIVE
	// extro-node read — the address is real for whatever adapter is configured.
	import { Copy, Check } from '@lucide/svelte';
	import Loader from '$lib/components/ui/Loader.svelte';
	import { deriveFamilyAddress, type FamilyAddress } from '$lib/extro/family';
	import type { AssetTab } from '$lib/stores/navigation.svelte';

	let { tab, label }: { tab: AssetTab; label: string } = $props();

	let result = $state<FamilyAddress | null>(null);
	let copied = $state(false);

	$effect(() => {
		let cancelled = false;
		result = null;
		deriveFamilyAddress(tab).then((r) => { if (!cancelled) result = r; });
		return () => { cancelled = true; };
	});

	const copy = async (address: string) => {
		await navigator.clipboard.writeText(address);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	};
</script>

<div class="animate-fade-in max-w-sm mx-auto w-full pt-4 space-y-3">
	<p class="text-center text-[13px] font-medium text-muted-foreground">{label}</p>

	{#if result === null}
		<div class="flex justify-center py-10"><Loader /></div>
	{:else if result.ok}
		<div class="rounded-3xl bg-muted/40 px-5 py-6">
			<p class="text-center text-[14px] font-medium text-foreground break-all leading-relaxed tabular-nums">{result.address}</p>
		</div>
		<button
			onclick={() => result?.ok && copy(result.address)}
			class="w-full h-14 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-[15px] font-medium transition-all duration-200 active:scale-[0.97]">
			{#if copied}<Check class="w-[18px] h-[18px]" />Copied{:else}<Copy class="w-[18px] h-[18px]" />Copy address{/if}
		</button>
	{:else}
		<div class="rounded-3xl bg-muted/40 px-6 py-10 text-center">
			<p class="text-[13px] text-muted-foreground leading-relaxed">Address unavailable — {result.error}</p>
		</div>
	{/if}
</div>
