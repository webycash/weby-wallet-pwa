<script lang="ts">
	import { Menu } from '@lucide/svelte';
	import { openMenu } from '$lib/stores/navigation.svelte';
	import type { NetworkMode } from '$lib/core/types';

	let { network, onNetworkChange, activeFamily, onSwitchFamily, isDesktop }: {
		network: NetworkMode;
		onNetworkChange: (n: NetworkMode) => void;
		activeFamily: string;
		onSwitchFamily: (f: string) => void;
		isDesktop: boolean;
	} = $props();

	const FAMILIES = [
		{ id: 'webcash', name: 'Webcash', enabled: true },
		{ id: 'bitcoin', name: 'Bitcoin', enabled: false },
		{ id: 'rgb', name: 'RGB', enabled: false },
		{ id: 'vouchers', name: 'Vouchers', enabled: false },
	];
</script>

<header class="sticky top-0 z-30 bg-background">
	{#if isDesktop}
		<!-- Desktop: logo left, tabs center, network right -->
		<div class="flex h-36 items-center justify-between px-12 max-w-7xl mx-auto">
			<div class="flex items-center shrink-0">
				<a href="https://weby.cash" class="flex items-center">
					<img src="/logo.svg" alt="weby" class="h-16 w-auto logo-tint dark:brightness-0 dark:invert" />
				</a>
			</div>

			<div class="flex rounded-full bg-muted/50 p-1 gap-1">
				{#each FAMILIES as fam}
					<button
						onclick={() => fam.enabled && onSwitchFamily(fam.id)}
						disabled={!fam.enabled}
						class="rounded-full px-8 py-3.5 text-[16px] font-medium tracking-wide transition-all duration-200
							{fam.id === activeFamily ? 'bg-background text-foreground shadow-sm' : ''}
							{fam.enabled ? 'hover:bg-background/60' : 'opacity-25 cursor-not-allowed text-muted-foreground'}">
						{fam.name}
					</button>
				{/each}
			</div>

			<div class="flex rounded-full bg-muted/50 p-1 shrink-0">
				<button
					onclick={() => onNetworkChange('production')}
					class="rounded-full px-6 py-3 text-[14px] font-medium tracking-wide transition-all duration-200
						{network === 'production' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
					Mainnet
				</button>
				<button
					onclick={() => onNetworkChange('testnet')}
					class="rounded-full px-6 py-3 text-[14px] font-medium tracking-wide transition-all duration-200
						{network === 'testnet' ? 'bg-danger text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
					Testnet
				</button>
			</div>
		</div>
	{:else}
		<!-- Mobile: logo left, hamburger right, tabs below full-width -->
		<div class="flex h-20 items-center justify-between px-5">
			<a href="https://weby.cash" class="flex items-center">
				<img src="/logo.svg" alt="weby" class="h-11 w-auto logo-tint dark:brightness-0 dark:invert" />
			</a>

			<button
				onclick={openMenu}
				class="flex items-center justify-center w-12 h-12 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
				aria-label="Open menu">
				<Menu class="w-7 h-7" />
			</button>
		</div>

		<!-- Family tabs below nav, full width -->
		<div class="px-5 pb-4">
			<div class="flex rounded-full bg-muted/50 p-0.5 gap-0.5 w-full">
				{#each FAMILIES as fam}
					<button
						onclick={() => fam.enabled && onSwitchFamily(fam.id)}
						disabled={!fam.enabled}
						class="flex-1 rounded-full py-2.5 text-[13px] font-medium tracking-wide transition-all duration-200
							{fam.id === activeFamily ? 'bg-background text-foreground shadow-sm' : ''}
							{fam.enabled ? 'hover:bg-background/60' : 'opacity-25 cursor-not-allowed text-muted-foreground'}">
						{fam.name}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</header>
