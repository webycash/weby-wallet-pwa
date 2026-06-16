<script lang="ts">
	import { onMount } from 'svelte';
	import { getBalance, getStats, getWebcash, exportWalletSnapshot, exportMasterBackup,
		insertWebcash, payWebcash, checkWallet, mergeOutputs, recoverWallet, resetDb,
		setActive, addWallet, listWallets, getActiveFamily, getActiveLabel,
		lockWallet, getRawState, isRoaming, canMine, type WalletInfo } from '$lib/stores/wallet.svelte';
	import { getNetwork, setNetwork } from '$lib/stores/network.svelte';
	import { encryptionType } from '$lib/stores/settings.svelte';
	import { encryptWithPassword } from '$lib/core/encryption';
	import * as Persistence from '$lib/core/persistence';
	import { getWasm } from '$lib/core/wasm';
	import type { SecretWebcash, WalletStats, NetworkMode } from '$lib/core/types';
	import { nav, selectTab, closeSettings, isAssetTab } from '$lib/stores/navigation.svelte';

	import Header from './Header.svelte';
	import Sidebar from './Sidebar.svelte';
	import MobileMenu from './MobileMenu.svelte';
	import DashboardView from './DashboardView.svelte';
	import MiningView from './MiningView.svelte';
	import MergeView from './MergeView.svelte';
	import RecoveryView from './RecoveryView.svelte';
	import VerifyView from './VerifyView.svelte';
	import StatsView from './StatsView.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import AppDialog from './AppDialog.svelte';
	import ExchangeView from '../exchange/ExchangeView.svelte';
	import BitcoinView from '../bitcoin/BitcoinView.svelte';
	import RgbView from '../rgb/RgbView.svelte';
	import VouchersView from '../vouchers/VouchersView.svelte';
	import { initPushRouter, replayPushQueue, pushStatus } from '$lib/modules/webycash-exchange/push-store.svelte';
	import { setReferee, HttpRefereeClient } from '$lib/modules/webycash-exchange';
	import { REFEREE_URL, configuredAdapterMode } from '$lib/extro/config';

	let { pendingWebcash = '', onLock = () => {}, onInstall }: {
		pendingWebcash?: string;
		onLock?: () => void;
		onInstall?: () => void;
	} = $props();

	let balanceWats = $state(0);
	let walletStats = $state<WalletStats | null>(null);
	let webcashList = $state<SecretWebcash[]>([]);
	let network = $state<NetworkMode>(getNetwork());
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let loading = $state(false);
	let initializing = $state(true);
	let fmt = $state<((wats: number) => string) | null>(null);
	let paymentResult = $state('');
	let paymentMemo = $state('');
	const isStandalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

	let activeFamily = $state('webcash');
	let activeLabel = $state('main');
	let walletList = $state<WalletInfo[]>([]);
	let isRoamingWallet = $state(false);
	let appDialog = $state<ReturnType<typeof AppDialog>>();
	let isDesktop = $state(false);
	let showWalletDropdown = $state(false);

	let copiedError = $state(false);
	const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
		message = msg; messageType = type; copiedError = false;
		if (type !== 'error') setTimeout(() => { message = ''; }, 5000);
	};
	const dismissMessage = () => { message = ''; };
	const copyError = async () => {
		await navigator.clipboard.writeText(message);
		copiedError = true;
		setTimeout(() => { copiedError = false; }, 2000);
	};

	const saveEncryptedState = async () => {
		const encType = encryptionType();
		if (encType === 'none') return;
		try {
			const snapshot = await exportWalletSnapshot();
			if (encType === 'passkey') {
				const cid = localStorage.getItem('weby_passkey_credential');
				if (cid) Persistence.setEncryptedState(await encryptWithPassword(snapshot, cid));
			} else if (encType === 'password') {
				Persistence.setEncryptedState(JSON.stringify(snapshot));
			}
		} catch { /* best-effort */ }
	};

	const refresh = async () => {
		loading = true;
		try {
			activeFamily = await getActiveFamily();
			activeLabel = await getActiveLabel();
			isRoamingWallet = isRoaming();
			// A never-created non-webcash slot can throw inside ensureState
			// (no HD slot / derive failure). Honest behaviour is balance 0, NOT a
			// blanked app — guard each query so a missing family degrades cleanly.
			try { walletList = await listWallets(activeFamily); } catch { walletList = []; }
			try { balanceWats = await getBalance(); } catch { balanceWats = 0; }
			try { walletStats = await getStats(); } catch { walletStats = null; }
			try { webcashList = await getWebcash(); } catch { webcashList = []; }
		} finally { loading = false; }
	};

	const switchFamily = async (family: string) => {
		if (family === activeFamily) return;
		try { await setActive(family, 'main'); } catch { /* degrade to 0 below */ }
		await refresh();
	};

	const switchWallet = async (label: string) => {
		if (label === activeLabel) return;
		await setActive(activeFamily, label);
		await refresh();
	};

	const handleNewWallet = async () => {
		const label = await appDialog?.prompt('New Wallet', { placeholder: 'e.g. savings', label: 'Wallet name' });
		if (!label?.trim()) return;
		try {
			await addWallet(activeFamily, label.trim());
			await setActive(activeFamily, label.trim());
			await refresh();
			showMessage(`Wallet "${label.trim()}" created`);
		} catch (e) { showMessage(`${e}`, 'error'); }
	};

	const handleNetworkChange = (n: NetworkMode) => {
		network = n; setNetwork(n); resetDb(); refresh();
	};

	const handleInsert = async (s: string) => { loading = true; const r = await insertWebcash(s); if (r.ok) { showMessage('Webcash inserted'); await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handlePay = async (a: number, memo: string = '') => { loading = true; const r = await payWebcash(a); if (r.ok) { paymentResult = r.value; paymentMemo = memo; await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handleCheck = async () => { loading = true; const r = await checkWallet(); if (r.ok) showMessage(`${r.value.validCount} valid, ${r.value.spentCount} spent`); else showMessage(r.error, 'error'); loading = false; };
	const handleMerge = async () => { loading = true; const r = await mergeOutputs(50); if (r.ok) { showMessage(r.value); await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handleRecover = async () => { loading = true; const r = await recoverWallet(20); if (r.ok) { showMessage(`Recovered ${r.value.recoveredCount} outputs`); await refresh(); } else showMessage(r.error, 'error'); loading = false; };

	const handleVisibility = () => {
		if (document.visibilityState === 'hidden') {
			saveEncryptedState();
		} else if (encryptionType() !== 'none') {
			lockWallet();
			onLock();
		}
	};

	// Mining CAPABILITY is a property of the wallet (main, non-roaming) — NOT of
	// the active tab. The Mining *menu* is Webcash-only (it lives only in the
	// Webcash menu data), but an in-progress miner must keep running in the
	// background while the user browses Bitcoin/Exchange/etc., so the persistent
	// mount below stays alive across tabs.
	const canMineWallet = $derived(activeLabel === 'main' && !isRoamingWallet);
	const activeTab = $derived(nav.activeTab);
	const activeView = $derived(nav.activeView);

	// Observe the active tab: when it is an asset family, ensure the wallet store's
	// active family matches (setActive + refresh, via switchFamily). `exchange` is
	// a mode, not a family — never switch for it. This is the ONE place the pure
	// nav store's intent becomes a wallet side effect.
	$effect(() => {
		const tab = nav.activeTab;
		if (isAssetTab(tab) && tab !== activeFamily) void switchFamily(tab);
	});

	// Mount MinerPanel lazily — only when the user navigates to mining. Mounting
	// on load (previously triggered by a stored snapshot) caused a WebGPU init
	// on every page load which, on iOS, contributed to the memory-kill loop.
	let miningMounted = $state(false);
	$effect(() => { if (activeTab === 'webcash' && activeView === 'mining' && canMineWallet) miningMounted = true; });

	onMount(() => {
		const mq = window.matchMedia('(min-width: 768px)');
		isDesktop = mq.matches;
		const listener = (e: MediaQueryListEvent) => { isDesktop = e.matches; };
		mq.addEventListener('change', listener);

		// Wire the exchange push router to the service worker. AppShell mounts
		// only when the wallet is unlocked (see +page.svelte), so the router runs
		// in the unlocked state: pushes that arrive while the app is open are
		// routed, deduped, dispatched, and acked here.
		//
		// NOTE: a push that arrives while the app is CLOSED or on the LockScreen
		// has no in-page listener yet, so it is not queued in-memory by this
		// router. Durable queue-while-locked (the SW persisting safe metadata to
		// IndexedDB and the app draining it on unlock) is a deferred integration;
		// `replayPushQueue` drains anything this router queued during THIS session
		// (e.g. a transient re-lock) and is a no-op otherwise.
		initPushRouter(() => true);
		void replayPushQueue();

		// Inject the real HTTP referee (dev.weby.cash/api/referee) when running the
		// bundled adapter against a configured backend. MockRefereeClient stays the
		// default for tests / SSR / the mock adapter (per referee-client.ts).
		if (configuredAdapterMode() !== 'mock' && /^https?:\/\//.test(REFEREE_URL)) {
			setReferee(new HttpRefereeClient({ baseUrl: REFEREE_URL }));
		}

		(async () => {
			const wasm = await getWasm();
			fmt = (wats: number) => wasm.format_amount(BigInt(wats));
			await refresh();
			initializing = false;
			await document.fonts.ready;
			const appLoader = document.getElementById('app-loader');
			if (appLoader) appLoader.remove();
			const appRoot = document.getElementById('app-root');
			if (appRoot) appRoot.style.opacity = '1';
			if (pendingWebcash) { selectTab('webcash'); setTimeout(() => handleInsert(pendingWebcash), 500); }
		})();
		document.addEventListener('visibilitychange', handleVisibility);

		return () => {
			mq.removeEventListener('change', listener);
			document.removeEventListener('visibilitychange', handleVisibility);
		};
	});
</script>

{#if initializing}
	<div class="min-h-[60vh]"></div>
{:else}
	<div class="min-h-screen bg-background">
		<Header {network} onNetworkChange={handleNetworkChange} {isDesktop} />

		{#if !isDesktop}
			<MobileMenu {canMineWallet} {network} onNetworkChange={handleNetworkChange} />
		{/if}

		<!-- Centered sidebar + content. The Exchange is a full-width trading
		     surface (multi-column on desktop); asset tabs stay a focused column. -->
		<div class="{isDesktop ? (activeTab === 'exchange' ? 'flex justify-center max-w-[1440px] mx-auto' : 'flex justify-center max-w-4xl mx-auto') : ''}">
			{#if isDesktop}
				<Sidebar {canMineWallet} />
			{/if}

			<main class="px-5 py-4 md:py-6 flex-1 {activeTab === 'exchange' ? 'max-w-none' : 'max-w-lg'} {isDesktop ? '' : 'mx-auto'}">
				<!-- Wallet selector — asset tabs only (Exchange is a mode, not a family) -->
				{#if isAssetTab(activeTab)}
					<div class="flex justify-center mb-4">
						<button onclick={() => showWalletDropdown = !showWalletDropdown}
							class="flex items-center gap-2 px-4 py-2 rounded-full bg-muted/40 hover:bg-muted/60 text-[15px] font-medium transition-all duration-200 relative">
							<span class="capitalize">{activeLabel}</span>
							{#if isRoamingWallet}
								<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium">R</span>
							{/if}
							<svg class="w-3 h-3 opacity-40 transition-transform duration-200 {showWalletDropdown ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
						</button>
						{#if showWalletDropdown}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="fixed inset-0 z-40" onclick={() => showWalletDropdown = false}></div>
							<div class="absolute mt-12 z-50 min-w-[12rem] rounded-2xl bg-popover shadow-xl overflow-hidden animate-scale-in">
								{#each walletList as w}
									<button
										onclick={() => { switchWallet(w.label); showWalletDropdown = false; }}
										class="w-full px-4 py-2.5 text-[13px] text-left transition-all duration-150
											{w.label === activeLabel ? 'bg-primary/8 font-medium' : 'hover:bg-muted/40'}">
										<span class="capitalize">{w.label}</span>
										{#if w.roaming}<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium ml-1.5">R</span>{/if}
										{#if fmt && w.balance > 0}<span class="text-xs opacity-35 ml-1.5">{fmt(w.balance)}</span>{/if}
									</button>
								{/each}
								<button onclick={() => { handleNewWallet(); showWalletDropdown = false; }}
									class="w-full px-4 py-2.5 text-[13px] text-left text-muted-foreground hover:bg-muted/40 transition-all duration-150">
									+ New wallet
								</button>
							</div>
						{/if}
					</div>
				{/if}

				<!-- MiningView persists once visited so mining never stops on navigate -->
				{#if miningMounted && canMineWallet}
					<div class={activeTab === 'webcash' && activeView === 'mining' ? 'animate-fade-in' : 'hidden'}>
						<MiningView {network} {canMineWallet} onBalanceUpdate={refresh} />
					</div>
				{/if}

				<!-- Router: branch on the active TAB first, then the view within it.
				     View ids (balance/receive/history/issue) repeat across tabs, so
				     keying on tab+view is mandatory. -->
				{#key `${activeTab}:${activeView}`}
					{#if activeTab === 'webcash'}
						{#if activeView === 'balance'}
							<DashboardView
								{balanceWats} formatAmount={fmt} {network} {loading}
								{message} {messageType} {copiedError}
								onInsert={handleInsert} onPay={handlePay}
								{paymentResult} {paymentMemo}
								onDismissMessage={dismissMessage} onCopyError={copyError}
								onClearPayment={() => { paymentResult = ''; paymentMemo = ''; }}
								{isStandalone} {isDesktop} onInstall={onInstall} />
						{:else if activeView === 'mining'}
							<!-- rendered above, outside #key, to persist -->
						{:else if activeView === 'merge'}
							<MergeView {loading} onMerge={handleMerge} />
						{:else if activeView === 'recover'}
							<RecoveryView {loading} onRecover={handleRecover} />
						{:else if activeView === 'verify'}
							<VerifyView />
						{:else if activeView === 'stats'}
							<StatsView stats={walletStats} webcash={webcashList} formatAmount={fmt} />
						{/if}
					{:else if activeTab === 'bitcoin'}
						<BitcoinView {network} />
					{:else if activeTab === 'rgb'}
						<RgbView />
					{:else if activeTab === 'vouchers'}
						<VouchersView />
					{:else if activeTab === 'exchange'}
						<ExchangeView {isDesktop} />
					{/if}
				{/key}

				{#if message && messageType === 'success' && !(activeTab === 'webcash' && activeView === 'balance')}
					<div class="mt-6 rounded-2xl px-4 py-3 text-sm font-medium bg-primary/8 text-primary text-center">
						{message}
					</div>
				{/if}
			</main>
		</div>

		<!-- Global Settings overlay — reachable from any tab, gated on nav.settingsOpen -->
		{#if nav.settingsOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="fixed inset-0 z-50 bg-background/60 backdrop-blur-md" onclick={closeSettings}></div>
			<div class="fixed top-4 left-4 right-4 bottom-4 md:inset-x-auto md:inset-y-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md md:max-h-[80vh] z-50 bg-background rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-in"
				role="dialog" aria-modal="true" aria-label="Settings">
				<div class="flex items-center justify-between px-6 py-5">
					<h2 class="text-[17px] font-semibold">Settings</h2>
					<button onclick={closeSettings}
						class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
						aria-label="Close">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
					</button>
				</div>
				<div class="flex-1 overflow-y-auto px-4 pb-5">
					<SettingsPanel {activeFamily} {activeLabel} {isRoamingWallet}
						onRefresh={refresh} onMessage={showMessage} {appDialog} />
				</div>
			</div>
		{/if}
	</div>

	<!-- Error modal -->
	{#if message && messageType === 'error'}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-50 bg-background/60 backdrop-blur-md" onclick={dismissMessage}></div>
		<div class="fixed top-14 left-4 right-4 bottom-4 md:inset-x-auto md:inset-y-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md z-50 bg-background rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-in"
			role="dialog" aria-modal="true" aria-label="Error">
			<div class="flex items-center justify-between px-6 py-5">
				<h2 class="text-[17px] font-semibold">Something went wrong</h2>
				<button onclick={dismissMessage}
					class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
					aria-label="Close">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="px-5 pb-5">
				<p class="text-[13px] text-muted-foreground leading-relaxed break-words mb-4">{message}</p>
				<button onclick={copyError}
					class="w-full h-10 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-[13px] font-medium transition-all duration-200 active:scale-[0.97]">
					{copiedError ? 'Copied' : 'Copy Error'}
				</button>
			</div>
		</div>
	{/if}

	<AppDialog bind:this={appDialog} />
{/if}
