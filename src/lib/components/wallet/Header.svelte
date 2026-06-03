<script lang="ts">
	// Top bar = the five top-level TABS (Webcash · Bitcoin · RGB · Vouchers ·
	// Exchange), driven entirely from the nav store's `TABS` data. The active tab
	// IS the wallet family — there is no separate family switch. Logo returns to
	// the default Webcash tab; the Mainnet/Testnet toggle stays.
	import { Menu } from '@lucide/svelte';
	import { TABS, nav, selectTab, openMenu } from '$lib/stores/navigation.svelte';
	import type { NetworkMode } from '$lib/core/types';

	let { network, onNetworkChange, isDesktop }: {
		network: NetworkMode;
		onNetworkChange: (n: NetworkMode) => void;
		isDesktop: boolean;
	} = $props();
</script>

<header class="sticky top-0 z-30 bg-background">
	{#if isDesktop}
		<!-- Desktop: logo left, tabs center, network right -->
		<div class="flex h-40 items-center justify-between px-12 max-w-7xl mx-auto">
			<div class="flex items-center shrink-0">
				<button onclick={() => selectTab('webcash')} class="flex items-center">
					<img src="/logo.svg" alt="weby" class="h-20 w-auto dark:brightness-0 dark:invert" />
				</button>
			</div>

			<div class="flex rounded-full bg-muted/50 p-1 gap-1">
				{#each TABS as tab}
					<button
						onclick={() => selectTab(tab.id)}
						class="rounded-full px-9 py-4 text-[18px] font-medium tracking-wide transition-all duration-200 hover:bg-background/60
							{tab.id === nav.activeTab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}">
						{tab.label}
					</button>
				{/each}
			</div>

			<div class="flex rounded-full bg-muted/50 p-1 shrink-0">
				<button
					onclick={() => onNetworkChange('production')}
					class="rounded-full px-7 py-3.5 text-[15px] font-medium tracking-wide transition-all duration-200
						{network === 'production' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
					Mainnet
				</button>
				<button
					onclick={() => onNetworkChange('testnet')}
					class="rounded-full px-7 py-3.5 text-[15px] font-medium tracking-wide transition-all duration-200
						{network === 'testnet' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
					Testnet
				</button>
			</div>
		</div>
	{:else}
		<!-- Mobile: logo left, hamburger right, tabs below full-width -->
		<div class="flex h-24 items-center justify-between px-5">
			<button onclick={() => selectTab('webcash')} class="flex items-center">
				<img src="/logo.svg" alt="weby" class="h-14 w-auto dark:brightness-0 dark:invert" />
			</button>

			<button
				onclick={openMenu}
				class="flex items-center justify-center w-14 h-14 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
				aria-label="Open menu">
				<Menu class="w-7 h-7" />
			</button>
		</div>

		<!-- Tabs below nav, full width -->
		<div class="px-5 pb-4">
			<div class="flex rounded-full bg-muted/50 p-0.5 gap-0.5 w-full">
				{#each TABS as tab}
					<button
						onclick={() => selectTab(tab.id)}
						class="flex-1 rounded-full py-2.5 text-[13px] font-medium tracking-wide transition-all duration-200 hover:bg-background/60
							{tab.id === nav.activeTab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}">
						{tab.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</header>
