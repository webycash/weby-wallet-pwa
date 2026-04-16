<script lang="ts">
	import { onMount } from 'svelte';
	import { getBalance, getStats, getWebcash, exportWalletSnapshot,
		insertWebcash, payWebcash, checkWallet, mergeOutputs } from '$lib/stores/wallet.svelte';
	import { getNetwork, setNetwork } from '$lib/stores/network.svelte';
	import { markBackedUp, backedUp, dismissBackup, backupDismissed } from '$lib/stores/settings.svelte';
	import { getWasm } from '$lib/core/wasm';
	import type { SecretWebcash, WalletStats, NetworkMode } from '$lib/core/types';

	import BalanceCard from './BalanceCard.svelte';
	import InsertForm from './InsertForm.svelte';
	import PayForm from './PayForm.svelte';
	import StatsPanel from './StatsPanel.svelte';
	import WebcashList from './WebcashList.svelte';
	import MinerPanel from './MinerPanel.svelte';

	let balanceWats = $state(0);
	let walletStats = $state<WalletStats | null>(null);
	let webcashList = $state<SecretWebcash[]>([]);
	let network = $state<NetworkMode>(getNetwork());
	let activePanel = $state<string | null>(null);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let loading = $state(false);
	let formatAmount = $state<((wats: number) => string) | null>(null);
	let showBackupWarning = $state(!backedUp() && !backupDismissed());

	const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
		message = msg;
		messageType = type;
		setTimeout(() => { message = ''; }, 5000);
	};

	const refresh = async () => {
		balanceWats = await getBalance();
		walletStats = await getStats();
		webcashList = await getWebcash();
	};

	const toggleNetwork = () => {
		network = network === 'production' ? 'testnet' : 'production';
		setNetwork(network);
		refresh();
	};

	const handleInsert = async (webcashStr: string) => {
		loading = true;
		const result = await insertWebcash(network, webcashStr);
		if (result.ok) { showMessage('Webcash inserted'); await refresh(); }
		else showMessage(result.error, 'error');
		loading = false;
	};

	const handlePay = async (amountWats: number, memo: string) => {
		loading = true;
		const result = await payWebcash(network, amountWats, memo);
		if (result.ok) { showMessage(`Payment sent: ${result.value}`); await refresh(); }
		else showMessage(result.error, 'error');
		loading = false;
	};

	const handleCheck = async () => {
		loading = true;
		const result = await checkWallet(network);
		if (result.ok) {
			const { validCount, spentCount } = result.value;
			showMessage(`Check: ${validCount} valid, ${spentCount} spent`);
			await refresh();
		} else showMessage(result.error, 'error');
		loading = false;
	};

	const handleMerge = async () => {
		loading = true;
		const result = await mergeOutputs(network, 50);
		if (result.ok) { showMessage(result.value); await refresh(); }
		else showMessage(result.error, 'error');
		loading = false;
	};

	const handleBackup = async () => {
		const snapshot = await exportWalletSnapshot();
		const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `weby-wallet-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
		markBackedUp();
		showBackupWarning = false;
		showMessage('Backup downloaded');
	};

	onMount(async () => {
		const wasm = await getWasm();
		formatAmount = wasm.format_amount;
		await refresh();
	});
</script>

<div class="container mx-auto px-6 py-8 max-w-2xl space-y-6">
	<!-- Backup warning -->
	{#if showBackupWarning}
		<div class="flex items-center justify-between rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2.5">
			<p class="text-xs text-amber-600 dark:text-amber-400">
				Wallet not backed up.
				<button onclick={handleBackup} class="underline font-medium hover:no-underline ml-1">Back up now</button>
			</p>
			<button onclick={() => { dismissBackup(); showBackupWarning = false; }} class="text-amber-500/50 hover:text-amber-500 text-lg leading-none">&times;</button>
		</div>
	{/if}

	<!-- Network toggle + refresh -->
	<div class="flex items-center justify-between">
		<button onclick={toggleNetwork}
			class="rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide uppercase transition-all {network === 'testnet'
				? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 hover:bg-amber-500/25'
				: 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20'}">
			{network === 'testnet' ? 'Testnet' : 'Production'}
		</button>
		<button onclick={refresh}
			class="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
			disabled={loading}>
			{loading ? 'Loading...' : 'Refresh'}
		</button>
	</div>

	<!-- Balance -->
	<BalanceCard {balanceWats} {formatAmount} />

	<!-- Status message -->
	{#if message}
		<div class="rounded-xl px-4 py-3 text-sm font-medium transition-all {messageType === 'error'
			? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
			: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'}">
			{message}
		</div>
	{/if}

	<!-- Action buttons -->
	<div class="grid grid-cols-3 gap-3 sm:grid-cols-6">
		{#each [
			{ id: 'insert', label: 'Insert', icon: '↓' },
			{ id: 'pay', label: 'Pay', icon: '↑' },
			{ id: 'check', label: 'Check', icon: '✓', action: handleCheck },
			{ id: 'merge', label: 'Merge', icon: '⊕', action: handleMerge },
			...(network === 'testnet' ? [{ id: 'mine', label: 'Mine', icon: '⛏' }] : []),
			{ id: 'backup', label: 'Backup', icon: '↗', action: handleBackup }
		] as btn}
			<button
				onclick={() => btn.action ? btn.action() : activePanel = activePanel === btn.id ? null : btn.id}
				class="flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-xs font-medium transition-all
					{activePanel === btn.id
						? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/10'
						: 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5'}"
				disabled={loading}>
				<span class="text-base">{btn.icon}</span>
				{btn.label}
			</button>
		{/each}
	</div>

	<!-- Panels -->
	{#if activePanel === 'insert'}
		<InsertForm onSubmit={handleInsert} disabled={loading} />
	{:else if activePanel === 'pay'}
		<PayForm onSubmit={handlePay} disabled={loading} {formatAmount} {balanceWats} />
	{:else if activePanel === 'mine'}
		<MinerPanel {network} />
	{/if}

	<!-- Stats -->
	{#if walletStats}
		<StatsPanel stats={walletStats} {formatAmount} />
	{/if}

	<!-- Webcash list -->
	<WebcashList webcash={webcashList} {formatAmount} />

	<!-- Privacy footer -->
	<p class="text-center text-xs text-muted-foreground/60 pt-2">
		All data stays on your device.
		<a href="https://github.com/webycash/weby-wallet-pwa" target="_blank" rel="noopener" class="hover:text-muted-foreground transition-colors">Source</a>
	</p>
</div>
