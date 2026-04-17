<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getBalance, getStats, getWebcash, exportWalletSnapshot,
		insertWebcash, payWebcash, checkWallet, mergeOutputs, resetDb } from '$lib/stores/wallet.svelte';
	import { getNetwork, setNetwork } from '$lib/stores/network.svelte';
	import { markBackedUp, backedUp, dismissBackup, backupDismissed,
		clearWallet, encryptionType } from '$lib/stores/settings.svelte';
	import { encryptWithPassword } from '$lib/core/encryption';
	import { getWasm } from '$lib/core/wasm';
	import type { SecretWebcash, WalletStats, NetworkMode } from '$lib/core/types';
	import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Merge, Pickaxe,
		Download, Settings, Trash2, Plus, QrCode, RotateCcw } from '@lucide/svelte';

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
	import EncryptionSetup from './EncryptionSetup.svelte';

	let { pendingWebcash = '' }: { pendingWebcash?: string } = $props();

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
	let paymentResult = $state('');
	let paymentMemo = $state('');

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
				if (cid) localStorage.setItem('weby_encrypted_wallet', await encryptWithPassword(snapshot, cid));
			} else if (encType === 'password') {
				localStorage.setItem('weby_encrypted_wallet', JSON.stringify(snapshot));
			}
		} catch { /* silent — encryption save is best-effort */ }
	};

	const refresh = async () => {
		loading = true;
		balanceWats = await getBalance(); walletStats = await getStats(); webcashList = await getWebcash();
		loading = false;
		saveEncryptedState();
	};

	const handleInsert = async (s: string) => { loading = true; const r = await insertWebcash(network, s); if (r.ok) { showMessage('Webcash inserted'); activePanel = null; await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handlePay = async (a: number, m: string) => { loading = true; const r = await payWebcash(network, a, m); if (r.ok) { paymentResult = r.value; paymentMemo = m; activePanel = 'payment-result'; await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handleCheck = async () => { loading = true; const r = await checkWallet(network); if (r.ok) showMessage(`${r.value.validCount} valid, ${r.value.spentCount} spent`); else showMessage(r.error, 'error'); loading = false; };
	const handleMerge = async () => { loading = true; const r = await mergeOutputs(network, 50); if (r.ok) { showMessage(r.value); await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handleRecover = async () => { loading = true; const { getMasterSecret, recoverWallet } = await import('$lib/stores/wallet.svelte'); const s = await getMasterSecret(); if (!s) { showMessage('No master secret', 'error'); loading = false; return; } const r = await recoverWallet(network, s, 20); if (r.ok) { showMessage(`Recovered ${r.value.recoveredCount} outputs`); await refresh(); } else showMessage(r.error, 'error'); loading = false; };
	const handleBackup = async () => { const snap = await exportWalletSnapshot(); const b = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `weby-wallet-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(u); markBackedUp(); showBackupWarning = false; showMessage('Backup downloaded'); };
	const handleQrExport = async () => { const { getMasterSecret } = await import('$lib/stores/wallet.svelte'); const s = await getMasterSecret(); if (!s) return; const QR = (await import('qrcode')).default; qrDataUrl = await QR.toDataURL(s, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } }); };

	const handleDeleteWallet = async () => { if (confirm('Delete this wallet? Make sure you have a backup.')) { const { resetWallet } = await import('$lib/core/reset'); await resetWallet(); window.location.reload(); } };
	const handleNewWallet = async () => { if (confirm('Create a new wallet? Back up first!')) { const { resetWallet } = await import('$lib/core/reset'); await resetWallet(); window.location.reload(); } };

	const toggle = (id: string) => { activePanel = activePanel === id ? null : id; };
	const handleVisibility = () => { if (document.visibilityState === 'hidden') saveEncryptedState(); };

	onMount(async () => {
		const wasm = await getWasm(); formatAmount = wasm.format_amount; await refresh();
		if (pendingWebcash) { activePanel = 'insert'; setTimeout(() => handleInsert(pendingWebcash), 500); }
		document.addEventListener('visibilitychange', handleVisibility);
		window.addEventListener('beforeunload', () => saveEncryptedState());
	});
	onDestroy(() => { document.removeEventListener('visibilitychange', handleVisibility); });

	const actions = $derived([
		{ id: 'insert', label: 'Receive', icon: ArrowDownToLine },
		{ id: 'pay', label: 'Send', icon: ArrowUpFromLine },
		{ id: 'verify', label: 'Verify', icon: ShieldCheck },
		{ id: 'merge', label: 'Merge', icon: Merge, action: handleMerge },
		{ id: 'recover', label: 'Recover', icon: RotateCcw, action: handleRecover },
		...(network === 'testnet' ? [{ id: 'mine', label: 'Mine', icon: Pickaxe }] : []),
		{ id: 'backup', label: 'Backup', icon: Download, action: handleBackup },
	]);
</script>

<div class="container mx-auto px-4 sm:px-6 py-6 max-w-2xl space-y-5">
	{#if showBackupWarning}
		<Card.Root class="border-warning bg-muted">
			<Card.Content class="flex items-center gap-3 py-3 px-4">
				<div class="w-2 h-2 rounded-full bg-warning animate-pulse shrink-0"></div>
				<p class="text-sm text-warning-foreground dark:text-warning-foreground flex-1">Wallet not backed up</p>
				<Button variant="ghost" size="sm" onclick={handleBackup} class="text-warning-foreground dark:text-warning-foreground h-8">Back up</Button>
				<button onclick={() => { dismissBackup(); showBackupWarning = false; }} class="text-warning-foreground hover:text-warning-foreground">&times;</button>
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="flex items-center justify-center gap-3">
		<div class="flex rounded-full border-2 border-border bg-muted p-0.5">
			<button onclick={() => { network = 'production'; setNetwork('production'); resetDb(); refresh(); }}
				class="rounded-full px-5 py-1.5 text-xs font-semibold transition-all {network === 'production' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
				Mainnet
			</button>
			<button onclick={() => { network = 'testnet'; setNetwork('testnet'); resetDb(); refresh(); }}
				class="rounded-full px-5 py-1.5 text-xs font-semibold transition-all {network === 'testnet' ? 'bg-warning text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
				Testnet
			</button>
		</div>
		<Button variant="outline" size="sm" onclick={() => showSettings = !showSettings}
			class={showSettings ? 'border-primary text-primary' : ''}>
			<Settings class="w-4 h-4" /> Settings
		</Button>
	</div>

	<BalanceCard {balanceWats} {formatAmount} {network} />

	{#if message}
		<Card.Root class={messageType === 'error' ? 'border-danger bg-muted' : 'border-success bg-muted'}>
			<Card.Content class="py-3 px-4">
				<p class="text-sm font-medium {messageType === 'error' ? 'text-danger-foreground dark:text-danger-foreground' : 'text-success-foreground dark:text-success-foreground'}">{message}</p>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if showSettings}
		<Card.Root>
			<Card.Header class="pb-2"><Card.Title class="text-center text-sm">Settings</Card.Title></Card.Header>
			<Card.Content class="space-y-4">
				<EncryptionSetup />
				<div class="flex flex-col gap-2 pt-3 border-t-2 border-border">
					<Button variant="outline" class="w-full" onclick={handleQrExport}><QrCode class="w-4 h-4" /> Pair QR Code</Button>
					<Button variant="outline" class="w-full" onclick={handleNewWallet}><Plus class="w-4 h-4" /> Create New Wallet</Button>
					<Button variant="destructive" class="w-full" onclick={handleDeleteWallet}><Trash2 class="w-4 h-4" /> Delete Wallet</Button>
				</div>
				{#if qrDataUrl}
					<div class="pt-3 border-t-2 border-border text-center">
						<p class="text-xs font-medium text-muted-foreground mb-3">Scan on mobile to import wallet</p>
						<div class="inline-block bg-white rounded-2xl p-4"><img src={qrDataUrl} alt="Wallet QR Code" class="w-52 h-52" /></div>
						<p class="text-xs text-muted-foreground mt-2">Contains your master secret — keep private</p>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="grid grid-cols-2 gap-2 max-w-md mx-auto w-full">
		{#each actions as btn, i}
			<Button
				variant="outline"
				class="w-full {i === actions.length - 1 && actions.length % 2 === 1 ? 'col-span-2' : ''}
					{activePanel === btn.id ? 'border-primary text-primary font-semibold' : ''}"
				onclick={() => btn.action ? btn.action() : toggle(btn.id)}
				disabled={loading}>
				{#if activePanel === btn.id}
					<btn.icon class="w-4 h-4 text-primary" /> {btn.label} ✕
				{:else}
					<btn.icon class="w-4 h-4" /> {btn.label}
				{/if}
			</Button>
		{/each}
	</div>

	{#if activePanel === 'insert'}
		<InsertForm onSubmit={handleInsert} disabled={loading} />
	{:else if activePanel === 'pay'}
		<PayForm onSubmit={handlePay} disabled={loading} {formatAmount} {balanceWats} />
	{:else if activePanel === 'payment-result'}
		<PaymentResult webcash={paymentResult} memo={paymentMemo} onDone={() => { activePanel = null; paymentResult = ''; paymentMemo = ''; }} />
	{:else if activePanel === 'verify'}
		<VerifyForm />
	{:else if activePanel === 'mine'}
		<MinerPanel {network} onBalanceUpdate={refresh} />
	{/if}

	{#if walletStats}
		<StatsPanel stats={walletStats} {formatAmount} />
	{/if}

	<WebcashList webcash={webcashList} {formatAmount} />

	<p class="text-center text-xs text-muted-foreground pt-2">All data stays on your device</p>
</div>
