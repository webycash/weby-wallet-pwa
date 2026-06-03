<script lang="ts">
	// Left menu = the active tab's `currentMenu()` (menu-as-data). Highlights
	// `nav.activeView`; clicking selects the view. Mining is hidden in Webcash
	// for roaming/non-main wallets (`!canMineWallet`). A persistent global
	// Settings button sits at the bottom, opening the settings overlay.
	import { Settings } from '@lucide/svelte';
	import { nav, currentMenu, selectView, openSettings } from '$lib/stores/navigation.svelte';

	let { canMineWallet }: { canMineWallet: boolean } = $props();

	// Hide Mining unless the active wallet can mine. Purely a filter over the
	// data menu — no per-tab branching here.
	const items = $derived(currentMenu().filter((item) => item.view !== 'mining' || canMineWallet));
</script>

<aside class="hidden md:flex flex-col w-48 shrink-0 sticky top-36 self-start pt-4">
	<nav class="px-2 flex flex-col space-y-1" aria-label="Wallet navigation">
		{#each items as item}
			<button
				onclick={() => selectView(item.view)}
				class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[18px] font-medium transition-all duration-200
					{nav.activeView === item.view && !nav.settingsOpen
						? 'bg-primary/10 text-primary'
						: 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}"
				aria-current={nav.activeView === item.view && !nav.settingsOpen ? 'page' : undefined}>
				<item.icon class="w-[24px] h-[24px] shrink-0" />
				{item.label}
			</button>
		{/each}

		<div class="h-4"></div>

		<button
			onclick={() => openSettings()}
			class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[18px] font-medium transition-all duration-200
				{nav.settingsOpen
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}"
			aria-current={nav.settingsOpen ? 'page' : undefined}>
			<Settings class="w-[24px] h-[24px] shrink-0" />
			Settings
		</button>
	</nav>
</aside>
