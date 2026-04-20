<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getBalance, getStats, getWebcash, exportWalletSnapshot, exportMasterBackup,
		insertWebcash, payWebcash, checkWallet, mergeOutputs, recoverWallet, resetDb,
		setActive, addWallet, listWallets, getActiveFamily, getActiveLabel,
		lockWallet, getRawState, isRoaming, canMine, type WalletInfo } from '$lib/stores/wallet.svelte';
	import { getNetwork, setNetwork } from '$lib/stores/network.svelte';
	import { markBackedUp, backedUp, dismissBackup, backupDismissed,
		clearWallet, encryptionType } from '$lib/stores/settings.svelte';
	import { encryptWithPassword } from '$lib/core/encryption';
	import * as Persistence from '$lib/core/persistence';
	import { getWasm } from '$lib/core/wasm';
	import type { SecretWebcash, WalletStats, NetworkMode } from '$lib/core/types';
	import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Merge, Pickaxe,
		Download, Settings, ChevronDown, RotateCcw, LoaderCircle, Share } from '@lucide/svelte';

	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';

	import BalanceCard from './BalanceCard.svelte';
	import InsertForm from './InsertForm.svelte';
	import PayForm from './PayForm.svelte';
	import VerifyForm from './VerifyForm.svelte';
	import StatsPanel from './StatsPanel.svelte';
	import WebcashList from './WebcashList.svelte';
	import MinerPanel from './MinerPanel.svelte';
	import PaymentResult from './PaymentResult.svelte';
	import SettingsPanel from './SettingsPanel.svelte';

	let { pendingWebcash = '', onLock = () => {} }: { pendingWebcash?: string; onLock?: () => void } = $props();

	let balanceWats = $state(0);
	let walletStats = $state<WalletStats | null>(null);
	let webcashList = $state<SecretWebcash[]>([]);
	let network = $state<NetworkMode>(getNetwork());
	let activePanel = $state<string | null>(null);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let loading = $state(false);
	let initializing = $state(true);
	let fmt = $state<((wats: number) => string) | null>(null);
	let showBackupWarning = $state(!backedUp() && !backupDismissed());
	let showSettings = $state(false);
	let paymentResult = $state('');
	let paymentMemo = $state('');

	// Multi-wallet state
	let activeFamily = $state('webcash');
	let activeLabel = $state('main');
	let walletList = $state<WalletInfo[]>([]);
	let showWalletDropdown = $state(false);
	let isRoamingWallet = $state(false);

	const FAMILIES = [
		{ id: 'webcash', name: 'Webcash', enabled: true },
		{ id: 'bitcoin', name: 'Bitcoin', enabled: false },
		{ id: 'rgb', name: 'RGB', enabled: false },
	];

	const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
		message = msg; messageType = type;
		setTimeout(() => { message = ''; }, 5000);
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
			walletList = await listWallets(activeFamily);
			balanceWats = await getBalance();
			walletStats = await getStats();
			webcashList = await getWebcash();
			// Close miner if switched to non-main wallet
			if (activePanel === 'mine' && !canMine()) activePanel = null;
		} finally { loading = false; }
	};

	const switchFamily = async (family: string) => {
		if (family === activeFamily) return;
		await setActive(family, 'main');
		await refresh();
	};

	const switchWallet = async (label: string) => {
		showWalletDropdown = false;
		if (label === activeLabel) return;
		await setActive(activeFamily, label);
		await refresh();
	};

	const handleNewWallet = async () => {
		showWalletDropdown = false;
		const label = prompt('Wallet label:');
		if (!label?.trim()) return;
		try {
			await addWallet(activeFamily, label.trim());
			await setActive(activeFamily, label.trim());
			await refresh();
			showMessage(`Wallet "${label.trim()}" created`);
		} catch (e) { showMessage(`${e}`, 'error'); }
	};

	// Action handlers
	const handleInsert = async (s: string) => { loading = true; const r = await insertWebcash(s); if (r.ok) { showMessage('Webcash inserted'); activePanel = null; await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handlePay = async (a: number, memo: string = '') => { loading = true; const r = await payWebcash(a); if (r.ok) { paymentResult = r.value; paymentMemo = memo; activePanel = 'payment-result'; await refresh(); } else showMessage(r.error, 'error'); loading = false; };
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

	onMount(async () => {
		const wasm = await getWasm();
		fmt = (wats: number) => wasm.format_amount(BigInt(wats));
		await refresh();
		initializing = false;
		const appRoot = document.getElementById('app-root');
		if (appRoot) appRoot.style.opacity = '1';
		const appLoader = document.getElementById('app-loader');
		if (appLoader) appLoader.remove();
		if (pendingWebcash) { activePanel = 'insert'; setTimeout(() => handleInsert(pendingWebcash), 500); }
		document.addEventListener('visibilitychange', handleVisibility);
	});
	onDestroy(() => document.removeEventListener('visibilitychange', handleVisibility));

	const canMineWallet = $derived(activeLabel === 'main' && !isRoamingWallet);
	let showMore = $state(false);

	const mainActions = [
		{ id: 'insert', label: 'Insert', icon: ArrowDownToLine },
		{ id: 'pay', label: 'Pay', icon: ArrowUpFromLine },
	];

	const moreActions = $derived([
		{ id: 'verify', label: 'Verify', icon: ShieldCheck },
		{ id: 'merge', label: 'Merge', icon: Merge, action: handleMerge },
		{ id: 'recover', label: 'Recover', icon: RotateCcw, action: handleRecover },
		...(canMineWallet ? [{ id: 'mine', label: 'Mine', icon: Pickaxe }] : []),
	]);
</script>

{#if initializing}
<div class="min-h-[60vh]"></div>
{:else}
<div class="container mx-auto px-5 sm:px-8 py-8 sm:py-12 max-w-xl space-y-7 sm:space-y-10 fade-in">
	{#if showBackupWarning}
		<div class="flex items-center gap-3 rounded-xl bg-muted px-4 py-3">
			<div class="w-1.5 h-1.5 rounded-full bg-danger shrink-0"></div>
			<p class="text-sm text-muted-foreground flex-1">Not backed up</p>
			<Button variant="outline" size="sm" onclick={async () => { const json = await exportMasterBackup(); const b = new Blob([json], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `weby-master-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(u); markBackedUp(); showBackupWarning = false; }} class="h-7 text-xs">Back up</Button>
			<button onclick={() => { dismissBackup(); showBackupWarning = false; }} class="text-muted-foreground hover:text-foreground text-sm">&times;</button>
		</div>
	{/if}

	<!-- Logo + Network toggle + Settings -->
	<div class="flex items-center justify-between">
		<a href="https://weby.cash" class="block">
			<img src="/wallet/logo.svg" alt="weby" class="h-24 dark:brightness-0 dark:invert" />
		</a>
		<div class="flex items-center gap-3">
		<div class="flex rounded-full border border-border bg-muted p-0.5">
			<button onclick={() => { network = 'production'; setNetwork('production'); resetDb(); refresh(); }}
				class="rounded-full px-5 py-1.5 text-xs font-semibold transition-all {network === 'production' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
				Mainnet
			</button>
			<button onclick={() => { network = 'testnet'; setNetwork('testnet'); resetDb(); refresh(); }}
				class="rounded-full px-5 py-1.5 text-xs font-semibold transition-all {network === 'testnet' ? 'bg-danger text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
				Testnet
			</button>
		</div>
		<Button variant="outline" size="sm" onclick={() => showSettings = !showSettings}
			class={showSettings ? 'border-primary text-primary' : ''}>
			<Settings class="w-4 h-4" />
		</Button>
		</div>
	</div>

	<!-- Wallet Family Tabs -->
	<div class="flex rounded-full bg-muted p-0.5 gap-0.5">
		{#each FAMILIES as fam}
			<button
				onclick={() => fam.enabled && switchFamily(fam.id)}
				disabled={!fam.enabled}
				class="flex-1 rounded-full px-4 py-2.5 text-xs font-semibold transition-all
					{fam.id === activeFamily ? 'bg-card text-foreground shadow-sm' : ''}
					{fam.enabled ? 'hover:bg-card/50' : 'opacity-40 cursor-not-allowed text-muted-foreground'}">
				{fam.name}
			</button>
		{/each}
	</div>

	<!-- Wallet Selector Dropdown -->
	<div class="relative flex justify-center">
		<button onclick={() => showWalletDropdown = !showWalletDropdown}
			class="flex items-center gap-2 px-4 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-sm font-medium transition-all">
			<span class="capitalize">{activeLabel}</span>
			{#if isRoamingWallet}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning font-semibold">Roaming</span>
			{/if}
			<ChevronDown class="w-3.5 h-3.5 opacity-60 transition-transform {showWalletDropdown ? 'rotate-180' : ''}" />
		</button>
		{#if showWalletDropdown}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="fixed inset-0 z-40" onclick={() => showWalletDropdown = false}></div>
			<div class="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 min-w-[10rem] rounded-2xl bg-muted shadow-lg overflow-hidden">
				{#each walletList as w}
					<button onclick={() => switchWallet(w.label)}
						class="w-full px-4 py-2.5 text-sm text-center hover:bg-background/50 transition-colors
							{w.label === activeLabel ? 'font-semibold' : 'opacity-70'}">
						<span class="capitalize">{w.label}</span>
						{#if w.roaming}
							<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning font-semibold ml-1">Roaming</span>
						{/if}
						{#if fmt && w.balance > 0}<span class="text-xs opacity-50 ml-1.5">{fmt(w.balance)}</span>{/if}
					</button>
				{/each}
				<button onclick={handleNewWallet}
					class="w-full px-4 py-2.5 text-sm text-center font-medium opacity-70 hover:opacity-100 hover:bg-background/50 transition-all">
					+ New wallet
				</button>
			</div>
		{/if}
	</div>

	<!-- Balance -->
	<BalanceCard {balanceWats} formatAmount={fmt} {network} />

	{#if message}
		<div class="rounded-xl px-4 py-3 text-sm font-medium {messageType === 'error' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}">
			{message}
		</div>
	{/if}

	<!-- Settings Panel -->
	{#if showSettings}
		<SettingsPanel {activeFamily} {activeLabel} {isRoamingWallet} onRefresh={refresh} onMessage={showMessage} />
	{/if}

	<!-- Main Actions -->
	<div class="grid grid-cols-2 gap-3 max-w-sm mx-auto w-full">
		{#each mainActions as btn}
			<Button variant="outline"
				class="w-full h-12 {activePanel === btn.id ? 'border-primary text-primary font-semibold' : ''}"
				onclick={() => (activePanel = activePanel === btn.id ? null : btn.id)}
				disabled={loading}>
				<btn.icon class="w-5 h-5 {activePanel === btn.id ? 'text-primary' : ''}" />
				{btn.label}
			</Button>
		{/each}
	</div>

	{#if activePanel === 'insert'}
		<InsertForm onSubmit={handleInsert} disabled={loading} />
	{:else if activePanel === 'pay'}
		<PayForm onSubmit={handlePay} disabled={loading} formatAmount={fmt} {balanceWats} />
	{:else if activePanel === 'payment-result'}
		<PaymentResult webcash={paymentResult} memo={paymentMemo} onDone={() => { activePanel = null; paymentResult = ''; paymentMemo = ''; }} />
	{/if}

	<!-- Accordions -->
	<div class="space-y-2">
		<!-- More -->
		<div class="rounded-xl bg-card overflow-hidden">
			<button onclick={() => showMore = !showMore}
				class="w-full px-5 py-3 flex items-center justify-between hover:bg-muted transition-all">
				<span class="text-xs font-semibold text-muted-foreground tracking-wider">More</span>
				<ChevronDown class="w-4 h-4 text-muted-foreground transition-transform {showMore ? 'rotate-180' : ''}" />
			</button>
			{#if showMore}
				<div class="px-5 pb-4 space-y-3">
					<div class="grid grid-cols-2 gap-2">
						{#each moreActions as btn}
							<Button variant="outline" size="sm"
								class="w-full {activePanel === btn.id ? 'border-primary text-primary font-semibold' : ''}"
								onclick={() => btn.action ? btn.action() : (activePanel = activePanel === btn.id ? null : btn.id)}
								disabled={loading}>
								<btn.icon class="w-4 h-4 {activePanel === btn.id ? 'text-primary' : ''}" />
								<span class="truncate">{btn.label}</span>
							</Button>
						{/each}
					</div>
					{#if activePanel === 'verify'}
						<VerifyForm />
					{:else if activePanel === 'mine'}
						<MinerPanel {network} onBalanceUpdate={refresh} />
					{/if}
				</div>
			{/if}
		</div>

		{#if walletStats}
			<StatsPanel stats={walletStats} formatAmount={fmt} />
		{/if}

		<WebcashList webcash={webcashList} formatAmount={fmt} />
	</div>

	<div class="flex items-center justify-between pt-4 pb-2">
		<p class="text-xs text-muted-foreground">All data stays on your device</p>
		<button onclick={() => {
			if ('standalone' in navigator && !(navigator as any).standalone && /iPhone|iPad/.test(navigator.userAgent)) {
				alert('Tap the Share button in Safari, then "Add to Home Screen"');
			} else if ('getInstalledRelatedApps' in navigator || window.matchMedia('(display-mode: standalone)').matches) {
				alert('App is already installed');
			} else {
				alert('Open this page in Safari or Chrome, then use "Add to Home Screen" or "Install App"');
			}
		}} class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-all">
			<img src="/wallet/favicon-96x96.png" alt="" class="w-7 h-7 rounded-lg" />
			Install App
		</button>
	</div>
</div>
{/if}
