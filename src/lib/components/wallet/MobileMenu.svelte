<script lang="ts">
	// Full-screen mobile menu mirroring the desktop nav, all from data: the five
	// TABS up top (selecting one swaps the menu below), the active tab's
	// `currentMenu()` as the view list, then a global Settings entry. No
	// per-tab branching, no sub-screen settings stack — Settings is the global
	// overlay (openSettings), opened straight from here.
	import { Settings, X } from '@lucide/svelte';
	import { TABS, nav, currentMenu, selectTab, selectView, openSettings, closeMenu } from '$lib/stores/navigation.svelte';
	import type { NetworkMode } from '$lib/core/types';

	let { canMineWallet, network, onNetworkChange }: {
		canMineWallet: boolean;
		network: NetworkMode;
		onNetworkChange: (n: NetworkMode) => void;
	} = $props();

	const open = $derived(nav.mobileMenuOpen);
	const items = $derived(currentMenu().filter((item) => item.view !== 'mining' || canMineWallet));
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 bg-background flex flex-col animate-scale-in"
		role="dialog" aria-modal="true" aria-label="Navigation menu">

		<div class="flex justify-end p-4">
			<button onclick={closeMenu}
				class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
				aria-label="Close menu">
				<X class="w-7 h-7" />
			</button>
		</div>

		<!-- Network toggle -->
		<div class="flex justify-center px-6 pb-3">
			<div class="flex rounded-full bg-muted/50 p-0.5 gap-0.5">
				<button
					onclick={() => onNetworkChange('production')}
					class="rounded-full px-5 py-2 text-[13px] font-medium tracking-wide transition-all duration-200
						{network === 'production' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
					Mainnet
				</button>
				<button
					onclick={() => onNetworkChange('testnet')}
					class="rounded-full px-5 py-2 text-[13px] font-medium tracking-wide transition-all duration-200
						{network === 'testnet' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
					Testnet
				</button>
			</div>
		</div>

		<!-- Top-level tabs -->
		<div class="px-6 pb-3">
			<div class="flex rounded-full bg-muted/50 p-0.5 gap-0.5 w-full">
				{#each TABS as tab}
					<button
						onclick={() => selectTab(tab.id)}
						class="flex-1 rounded-full py-2.5 text-[13px] font-medium tracking-wide transition-all duration-200
							{tab.id === nav.activeTab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}">
						{tab.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Active tab's view menu -->
		<div class="flex-1 overflow-y-auto px-6 pb-8">
			<nav class="space-y-1 pt-2" aria-label="Tab navigation">
				{#each items as item}
					<button
						onclick={() => selectView(item.view)}
						class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[19px] font-medium transition-all duration-200 active:scale-[0.98]
							{nav.activeView === item.view ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/40'}">
						<item.icon class="w-[22px] h-[22px] {nav.activeView === item.view ? '' : 'text-muted-foreground'}" />
						{item.label}
					</button>
				{/each}

				<div class="h-4"></div>

				<button
					onclick={() => openSettings()}
					class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[19px] font-medium text-foreground hover:bg-muted/40 transition-all duration-200 active:scale-[0.98]">
					<Settings class="w-[22px] h-[22px] text-muted-foreground" />
					Settings
				</button>
			</nav>
		</div>

		<div class="px-6 pb-8">
			<p class="text-[11px] text-muted-foreground/50 text-center">All data stays on your device</p>
		</div>
	</div>
{/if}
