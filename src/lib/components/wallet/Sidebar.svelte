<script lang="ts">
	import { Home, Pickaxe, Settings, BarChart3, ShieldCheck, Merge, RotateCcw } from '@lucide/svelte';
	import { nav, navigateTo, type View } from '$lib/stores/navigation.svelte';

	let { canMineWallet }: {
		canMineWallet: boolean;
	} = $props();

	const navItems: { id: View; label: string; icon: any }[] = [
		{ id: 'dashboard', label: 'Dashboard', icon: Home },
		{ id: 'mining', label: 'Mining', icon: Pickaxe },
		{ id: 'settings', label: 'Settings', icon: Settings },
		{ id: 'stats', label: 'Stats', icon: BarChart3 },
	];

	const actionItems: { id: View; label: string; icon: any }[] = [
		{ id: 'verify', label: 'Verify', icon: ShieldCheck },
		{ id: 'merge', label: 'Merge', icon: Merge },
		{ id: 'recovery', label: 'Recover', icon: RotateCcw },
	];

	const activeView = $derived(nav.activeView);
</script>

<aside class="hidden md:flex flex-col w-48 shrink-0 sticky top-36 self-start pt-4">
	<nav class="px-2 flex flex-col space-y-1" aria-label="Wallet navigation">
		{#each navItems as item}
			{#if item.id === 'mining' && !canMineWallet}
				<!-- skip -->
			{:else}
				<button
					onclick={() => navigateTo(item.id)}
					class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[18px] font-medium transition-all duration-200
						{activeView === item.id
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}"
					aria-current={activeView === item.id ? 'page' : undefined}>
					<item.icon class="w-[24px] h-[24px] shrink-0" />
					{item.label}
				</button>
			{/if}
		{/each}

		<div class="h-4"></div>

		{#each actionItems as item}
			<button
				onclick={() => navigateTo(item.id)}
				class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[18px] font-medium transition-all duration-200
					{activeView === item.id
						? 'bg-primary/10 text-primary'
						: 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}"
				aria-current={activeView === item.id ? 'page' : undefined}>
				<item.icon class="w-[24px] h-[24px] shrink-0" />
				{item.label}
			</button>
		{/each}
	</nav>

</aside>
