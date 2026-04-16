<script lang="ts">
	import { onMount } from 'svelte';
	import { getBalance, getStats, getWebcash, exportWalletSnapshot,
		insertWebcash, payWebcash, checkWallet, mergeOutputs } from '$lib/stores/wallet.svelte';
	import { getNetwork, setNetwork } from '$lib/stores/network.svelte';
	import { markBackedUp, backedUp, dismissBackup, backupDismissed,
		clearWallet, walletExists } from '$lib/stores/settings.svelte';
	import { getWasm } from '$lib/core/wasm';
	import type { SecretWebcash, WalletStats, NetworkMode } from '$lib/core/types';
	import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Merge, Pickaxe,
		Download, Settings, Trash2, Plus, RefreshCw, QrCode, RotateCcw } from '@lucide/svelte';

	import BalanceCard from './BalanceCard.svelte';
	import InsertForm from './InsertForm.svelte';
	import PayForm from './PayForm.svelte';
	import VerifyForm from './VerifyForm.svelte';
	import StatsPanel from './StatsPanel.svelte';
	import WebcashList from './WebcashList.svelte';
	import MinerPanel from './MinerPanel.svelte';
	import EncryptionSetup from './EncryptionSetup.svelte';

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
	let showSettings = $state(false);
	let qrDataUrl = $state('');

	const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
		message = msg;
		messageType = type;
		setTimeout(() => { message = ''; }, 5000);
	};

	const refresh = async () => {
		loading = true;
		balanceWats = await getBalance();
		walletStats = await getStats();
		webcashList = await getWebcash();
		loading = false;
	};

	const toggleNetwork = () => {
		network = network === 'production' ? 'testnet' : 'production';
		setNetwork(network);
		refresh();
	};

	const handleInsert = async (webcashStr: string) => {
		loading = true;
		const result = await insertWebcash(network, webcashStr);
		if (result.ok) { showMessage('Webcash inserted successfully'); activePanel = null; await refresh(); }
		else showMessage(result.error, 'error');
		loading = false;
	};

	const handlePay = async (amountWats: number, memo: string) => {
		loading = true;
		const result = await payWebcash(network, amountWats, memo);
		if (result.ok) { showMessage(`Payment sent: ${result.value}`); activePanel = null; await refresh(); }
		else showMessage(result.error, 'error');
		loading = false;
	};

	const handleCheck = async () => {
		loading = true;
		const result = await checkWallet(network);
		if (result.ok) {
			const { validCount, spentCount } = result.value;
			showMessage(`${validCount} valid, ${spentCount} spent`);
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

	const handleRecover = async () => {
		loading = true;
		const { getMasterSecret, recoverWallet } = await import('$lib/stores/wallet.svelte');
		const secret = await getMasterSecret();
		if (!secret) { showMessage('No master secret', 'error'); loading = false; return; }
		const result = await recoverWallet(network, secret, 20);
		if (result.ok) {
			showMessage(`Recovered ${result.value.recoveredCount} outputs`);
			await refresh();
		} else showMessage(result.error, 'error');
		loading = false;
	};

	const handleQrExport = async () => {
		const { getMasterSecret } = await import('$lib/stores/wallet.svelte');
		const secret = await getMasterSecret();
		if (!secret) return;
		const QRCode = (await import('qrcode')).default;
		qrDataUrl = await QRCode.toDataURL(secret, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } });
	};

	const handleDeleteWallet = () => {
		if (confirm('Delete this wallet? Make sure you have a backup. This cannot be undone.')) {
			indexedDB.deleteDatabase('weby-wallet');
			clearWallet();
			window.location.reload();
		}
	};

	const handleNewWallet = () => {
		if (confirm('Create a new wallet? The current wallet will be replaced. Back up first!')) {
			indexedDB.deleteDatabase('weby-wallet');
			clearWallet();
			window.location.reload();
		}
	};

	const toggle = (id: string) => {
		activePanel = activePanel === id ? null : id;
	};

	onMount(async () => {
		const wasm = await getWasm();
		formatAmount = wasm.format_amount;
		await refresh();
	});

	const actions = $derived([
		{ id: 'insert', label: 'Receive', icon: ArrowDownToLine, color: 'text-emerald-500' },
		{ id: 'pay', label: 'Send', icon: ArrowUpFromLine, color: 'text-blue-500' },
		{ id: 'verify', label: 'Verify', icon: ShieldCheck, color: 'text-violet-500' },
		{ id: 'merge', label: 'Merge', icon: Merge, color: 'text-orange-500', action: handleMerge },
		{ id: 'recover', label: 'Recover', icon: RotateCcw, color: 'text-teal-500', action: handleRecover },
		...(network === 'testnet' ? [{ id: 'mine', label: 'Mine', icon: Pickaxe, color: 'text-amber-500' }] : []),
		{ id: 'backup', label: 'Backup', icon: Download, color: 'text-cyan-500', action: handleBackup },
	]);
</script>

<div class="container mx-auto px-4 sm:px-6 py-6 max-w-2xl space-y-5">
	<!-- Backup warning -->
	{#if showBackupWarning}
		<div class="flex items-center gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
			<div class="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"></div>
			<p class="text-sm text-amber-600 dark:text-amber-400 flex-1">
				Wallet not backed up
			</p>
			<button onclick={handleBackup} class="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline shrink-0">Back up</button>
			<button onclick={() => { dismissBackup(); showBackupWarning = false; }} class="text-amber-400/50 hover:text-amber-400 ml-1 shrink-0">&times;</button>
		</div>
	{/if}

	<!-- Network selector + actions -->
	<div class="flex items-center justify-between">
		<div class="flex rounded-full border border-border/60 bg-muted/30 p-0.5">
			<button onclick={() => { network = 'production'; setNetwork('production'); refresh(); }}
				class="rounded-full px-4 py-1.5 text-xs font-semibold transition-all
					{network === 'production'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}">
				Mainnet
			</button>
			<button onclick={() => { network = 'testnet'; setNetwork('testnet'); refresh(); }}
				class="rounded-full px-4 py-1.5 text-xs font-semibold transition-all
					{network === 'testnet'
						? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}">
				Testnet
			</button>
		</div>
		<div class="flex items-center gap-1">
			<button onclick={refresh}
				class="rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
				disabled={loading}>
				<RefreshCw class="w-4 h-4 {loading ? 'animate-spin' : ''}" />
			</button>
			<button onclick={() => showSettings = !showSettings}
				class="rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all
					{showSettings ? 'text-primary bg-primary/10' : ''}">
				<Settings class="w-4 h-4" />
			</button>
		</div>
	</div>

	<!-- Balance -->
	<BalanceCard {balanceWats} {formatAmount} {network} />

	<!-- Status message -->
	{#if message}
		<div class="rounded-2xl px-4 py-3 text-sm font-medium animate-in fade-in {messageType === 'error'
			? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
			: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'}">
			{message}
		</div>
	{/if}

	<!-- Action buttons -->
	<div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
		{#each actions as btn}
			<button
				onclick={() => btn.action ? btn.action() : toggle(btn.id)}
				class="flex flex-col items-center gap-1.5 rounded-3xl border px-2 py-3 transition-all
					{activePanel === btn.id
						? 'border-primary/40 bg-primary/5 shadow-sm'
						: 'border-border/50 bg-card hover:border-border hover:bg-muted/30'}"
				disabled={loading}>
				<btn.icon
					class="w-5 h-5 {activePanel === btn.id ? 'text-primary' : btn.color}" />
				<span class="text-[11px] font-medium {activePanel === btn.id ? 'text-primary' : 'text-muted-foreground'}">
					{btn.label}
				</span>
			</button>
		{/each}
	</div>

	<!-- Panels -->
	{#if activePanel === 'insert'}
		<InsertForm onSubmit={handleInsert} disabled={loading} />
	{:else if activePanel === 'pay'}
		<PayForm onSubmit={handlePay} disabled={loading} {formatAmount} {balanceWats} />
	{:else if activePanel === 'verify'}
		<VerifyForm />
	{:else if activePanel === 'mine'}
		<MinerPanel {network} onBalanceUpdate={refresh} />
	{/if}

	<!-- Settings panel -->
	{#if showSettings}
		<div class="rounded-2xl border border-border bg-card p-5 space-y-4">
			<h3 class="text-sm font-semibold text-foreground">Wallet Settings</h3>

			<EncryptionSetup />

			<div class="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
				<button onclick={handleQrExport}
					class="flex items-center justify-center gap-2 rounded-xl border border-border/50 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all">
					<QrCode class="w-4 h-4" />
					QR Export
				</button>
				<button onclick={handleNewWallet}
					class="flex items-center justify-center gap-2 rounded-xl border border-border/50 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all">
					<Plus class="w-4 h-4" />
					New Wallet
				</button>
				<button onclick={handleDeleteWallet}
					class="flex items-center justify-center gap-2 rounded-xl border border-red-500/20 px-3 py-2.5 text-sm text-red-500/70 hover:text-red-500 hover:border-red-500/40 hover:bg-red-500/5 transition-all">
					<Trash2 class="w-4 h-4" />
					Delete
				</button>
			</div>

			<!-- QR Code display -->
			{#if qrDataUrl}
				<div class="pt-3 border-t border-border/50">
					<p class="text-xs font-medium text-muted-foreground mb-2">Scan on mobile to import wallet</p>
					<div class="flex justify-center bg-white rounded-xl p-4">
						<img src={qrDataUrl} alt="Wallet QR Code" class="w-48 h-48" />
					</div>
					<p class="text-[10px] text-muted-foreground/50 text-center mt-2">Contains your master secret — keep private</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Stats -->
	{#if walletStats}
		<StatsPanel stats={walletStats} {formatAmount} />
	{/if}

	<!-- Webcash list -->
	<WebcashList webcash={webcashList} {formatAmount} />

	<!-- Privacy -->
	<p class="text-center text-[11px] text-muted-foreground/40 pt-2">
		All data stays on your device
	</p>
</div>
