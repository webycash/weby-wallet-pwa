<script lang="ts">
	import { onMount } from 'svelte';
	import { getBalance, getStats, getWebcash, getMasterSecret, exportWalletSnapshot,
		insertWebcash, payWebcash, checkWallet, mergeOutputs } from '$lib/stores/wallet.svelte';
	import { getNetwork, setNetwork } from '$lib/stores/network.svelte';
	import { markBackedUp } from '$lib/stores/settings.svelte';
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
			showMessage(`Check complete: ${validCount} valid, ${spentCount} spent`);
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
		showMessage('Backup downloaded');
	};

	const handleShowSecret = async () => {
		const secret = await getMasterSecret();
		if (secret) {
			await navigator.clipboard.writeText(secret);
			showMessage('Master secret copied to clipboard');
		}
	};

	onMount(async () => {
		const wasm = await getWasm();
		formatAmount = wasm.format_amount;
		await refresh();
	});
</script>

<div class="container mx-auto px-4 py-6 max-w-2xl space-y-4">
	<!-- Network toggle -->
	<div class="flex items-center justify-between">
		<button onclick={toggleNetwork}
			class="rounded-full px-3 py-1 text-xs font-medium transition-colors {network === 'testnet'
				? 'bg-warning/20 text-warning border border-warning/30'
				: 'bg-primary/10 text-primary border border-primary/20'}">
			{network === 'testnet' ? 'Testnet' : 'Production'}
		</button>
		<button onclick={refresh}
			class="text-xs text-muted-foreground hover:text-foreground transition-colors"
			disabled={loading}>
			Refresh
		</button>
	</div>

	<!-- Balance -->
	<BalanceCard {balanceWats} {formatAmount} />

	<!-- Status message -->
	{#if message}
		<div class="rounded-lg px-4 py-2 text-sm {messageType === 'error'
			? 'bg-destructive/10 text-destructive border border-destructive/20'
			: 'bg-primary/10 text-primary border border-primary/20'}">
			{message}
		</div>
	{/if}

	<!-- Action buttons -->
	<div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
		{#each [
			{ id: 'insert', label: 'Insert' },
			{ id: 'pay', label: 'Pay' },
			{ id: 'check', label: 'Check', action: handleCheck },
			{ id: 'merge', label: 'Merge', action: handleMerge },
			...(network === 'testnet' ? [{ id: 'mine', label: 'Mine' }] : []),
			{ id: 'backup', label: 'Backup', action: handleBackup }
		] as btn}
			<button
				onclick={() => btn.action ? btn.action() : activePanel = activePanel === btn.id ? null : btn.id}
				class="rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors
					{activePanel === btn.id ? 'border-primary text-primary bg-primary/5' : 'text-muted-foreground'}"
				disabled={loading}>
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

	<!-- Stats + Webcash list -->
	{#if walletStats}
		<StatsPanel stats={walletStats} {formatAmount} />
	{/if}

	<WebcashList webcash={webcashList} {formatAmount} />

	<!-- Footer actions -->
	<div class="flex justify-center gap-4 pt-4 border-t border-border/40">
		<button onclick={handleShowSecret}
			class="text-xs text-muted-foreground hover:text-foreground transition-colors">
			Copy Master Secret
		</button>
	</div>
</div>
