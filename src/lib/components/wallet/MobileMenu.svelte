<script lang="ts">
	import { Home, Pickaxe, Settings, BarChart3, ShieldCheck, Merge, RotateCcw, X, ArrowLeft, Key, Lock, ChevronRight } from '@lucide/svelte';
	import { nav, closeMenu, navigateTo, pushSettings, popSettings,
		pushSettingsDetail, popSettingsDetail, type View, type SettingsTab } from '$lib/stores/navigation.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import type AppDialog from './AppDialog.svelte';

	import type { NetworkMode } from '$lib/core/types';

	let { activeFamily, activeLabel, isRoamingWallet, canMineWallet,
		network, onNetworkChange,
		onRefresh, onMessage, appDialog }: {
		activeFamily: string;
		activeLabel: string;
		isRoamingWallet: boolean;
		canMineWallet: boolean;
		network: NetworkMode;
		onNetworkChange: (n: NetworkMode) => void;
		onRefresh: () => Promise<void>;
		onMessage: (msg: string, type?: 'success' | 'error') => void;
		appDialog?: ReturnType<typeof AppDialog>;
	} = $props();

	const navItems: { id: View; label: string; icon: any }[] = [
		{ id: 'dashboard', label: 'Dashboard', icon: Home },
		{ id: 'mining', label: 'Mining', icon: Pickaxe },
		{ id: 'stats', label: 'Stats & Log', icon: BarChart3 },
	];

	const actionItems: { id: View; label: string; icon: any }[] = [
		{ id: 'verify', label: 'Verify', icon: ShieldCheck },
		{ id: 'merge', label: 'Merge', icon: Merge },
		{ id: 'recovery', label: 'Recover', icon: RotateCcw },
	];

	const settingsSections: { id: SettingsTab; label: string; enabled: boolean }[] = [
		{ id: 'wallet', label: 'Selected', enabled: true },
		{ id: 'master', label: 'Master', enabled: true },
		{ id: 'webcash', label: 'Webcash', enabled: true },
		{ id: 'bitcoin', label: 'Bitcoin', enabled: false },
		{ id: 'rgb', label: 'RGB', enabled: false },
		{ id: 'vouchers', label: 'Vouchers', enabled: false },
	];

	const open = $derived(nav.mobileMenuOpen);
	const screen = $derived(nav.mobileScreen);
	const settingsTab = $derived(nav.activeSettingsTab);

	const sectionMap: Record<string, 'wallet' | 'master' | 'webcash' | undefined> = {
		wallet: 'wallet', master: 'master', webcash: 'webcash',
	};

	const detailTitle = $derived(settingsSections.find(s => s.id === settingsTab)?.label ?? 'Settings');
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 bg-background flex flex-col animate-scale-in"
		role="dialog"
		aria-modal="true"
		aria-label="Navigation menu">

		{#if screen === 'menu'}
			<!-- Main menu -->
			<div class="flex justify-end p-4">
				<button onclick={closeMenu}
					class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
					aria-label="Close menu">
					<X class="w-7 h-7" />
				</button>
			</div>

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

			<div class="flex-1 overflow-y-auto px-6 pb-8">
				<nav class="space-y-1 pt-4" aria-label="Main navigation">
					{#each navItems as item}
						{#if item.id === 'mining' && !canMineWallet}
							<!-- skip -->
						{:else}
							<button
								onclick={() => navigateTo(item.id)}
								class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[19px] font-medium text-foreground hover:bg-muted/40 transition-all duration-200 active:scale-[0.98]">
								<item.icon class="w-[22px] h-[22px] text-muted-foreground" />
								{item.label}
							</button>
						{/if}
					{/each}

					<button
						onclick={pushSettings}
						class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[19px] font-medium text-foreground hover:bg-muted/40 transition-all duration-200 active:scale-[0.98]">
						<Settings class="w-[22px] h-[22px] text-muted-foreground" />
						Settings
					</button>

					<div class="h-4"></div>

					{#each actionItems as item}
						<button
							onclick={() => navigateTo(item.id)}
							class="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-[19px] font-medium text-foreground hover:bg-muted/40 transition-all duration-200 active:scale-[0.98]">
							<item.icon class="w-[22px] h-[22px] text-muted-foreground" />
							{item.label}
						</button>
					{/each}
				</nav>
			</div>

			<div class="px-6 pb-8">
				<p class="text-[11px] text-muted-foreground/50 text-center">All data stays on your device</p>
			</div>

		{:else if screen === 'settings'}
			<!-- Settings section list -->
			<div class="flex items-center gap-3 p-4">
				<button onclick={popSettings}
					class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
					aria-label="Back">
					<ArrowLeft class="w-6 h-6" />
				</button>
				<h2 class="text-[19px] font-semibold">Settings</h2>
			</div>

			<div class="flex-1 overflow-y-auto px-6 pb-8">
				<nav class="space-y-1" aria-label="Settings sections">
					{#each settingsSections as section}
						<button
							onclick={() => section.enabled && pushSettingsDetail(section.id)}
							disabled={!section.enabled}
							class="w-full flex items-center justify-between px-4 py-4 rounded-2xl text-[19px] font-medium transition-all duration-200 active:scale-[0.98]
								{section.enabled ? 'text-foreground hover:bg-muted/40' : 'text-muted-foreground/30 cursor-not-allowed'}">
							<span>{section.label}</span>
							{#if section.enabled}
								<ChevronRight class="w-[18px] h-[18px] text-muted-foreground/40" />
							{:else}
								<span class="text-[11px] text-muted-foreground/30">Soon</span>
							{/if}
						</button>
					{/each}
				</nav>
			</div>

		{:else if screen === 'settings-detail'}
			<!-- Settings detail view -->
			<div class="flex items-center gap-3 p-4">
				<button onclick={popSettingsDetail}
					class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
					aria-label="Back">
					<ArrowLeft class="w-6 h-6" />
				</button>
				<h2 class="text-[19px] font-semibold">{detailTitle}</h2>
			</div>

			<div class="flex-1 overflow-y-auto px-4 pb-8">
				<SettingsPanel
					{activeFamily} {activeLabel} {isRoamingWallet}
					{onRefresh} {onMessage} {appDialog}
					section={sectionMap[settingsTab]} />
			</div>
		{/if}
	</div>
{/if}
