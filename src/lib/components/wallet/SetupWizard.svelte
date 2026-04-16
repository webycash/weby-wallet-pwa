<script lang="ts">
	import { setupWallet, importWalletSnapshot, recoverWallet } from '$lib/stores/wallet.svelte';
	import { markWalletCreated } from '$lib/stores/settings.svelte';
	import { getNetwork } from '$lib/stores/network.svelte';
	import type { WalletSnapshot } from '$lib/core/types';

	type Step = 'choose' | 'create' | 'recover' | 'import' | 'backup';

	let step = $state<Step>('choose');
	let masterSecret = $state('');
	let recoverInput = $state('');
	let error = $state('');
	let loading = $state(false);

	const createNew = async () => {
		loading = true;
		error = '';
		const result = await setupWallet();
		if (result.ok) {
			masterSecret = result.value;
			step = 'backup';
		} else {
			error = result.error;
		}
		loading = false;
	};

	const recoverFromSecret = async () => {
		loading = true;
		error = '';
		const trimmed = recoverInput.trim();
		const setupResult = await setupWallet(trimmed);
		if (!setupResult.ok) { error = setupResult.error; loading = false; return; }
		masterSecret = trimmed;

		const result = await recoverWallet(getNetwork(), trimmed, 20);
		if (result.ok) {
			markWalletCreated();
			window.location.reload();
		} else {
			error = result.error;
		}
		loading = false;
	};

	const importFile = async (e: Event) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		loading = true;
		error = '';
		try {
			const text = await file.text();
			const snapshot: WalletSnapshot = JSON.parse(text);
			const result = await importWalletSnapshot(snapshot);
			if (result.ok) {
				markWalletCreated();
				window.location.reload();
			} else {
				error = result.error;
			}
		} catch (e) {
			error = `Invalid file: ${e}`;
		}
		loading = false;
	};

	const finishSetup = () => {
		markWalletCreated();
		window.location.reload();
	};

	const copySecret = () => {
		navigator.clipboard.writeText(masterSecret);
	};
</script>

<div class="container mx-auto px-4 py-8 max-w-lg">
	{#if step === 'choose'}
		<div class="text-center mb-8">
			<h1 class="text-2xl font-bold text-primary mb-2">Welcome to Weby Wallet</h1>
			<p class="text-sm text-muted-foreground">Your webcash stays on your device. Always.</p>
		</div>

		<div class="space-y-3">
			<button onclick={() => createNew()}
				class="w-full rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40 transition-colors"
				disabled={loading}>
				<span class="font-semibold text-foreground">Create New Wallet</span>
				<span class="block text-xs text-muted-foreground mt-1">Generate a fresh master secret</span>
			</button>

			<button onclick={() => { step = 'recover' }}
				class="w-full rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40 transition-colors">
				<span class="font-semibold text-foreground">Recover from Master Secret</span>
				<span class="block text-xs text-muted-foreground mt-1">Enter your 64-character hex secret</span>
			</button>

			<label
				class="w-full rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40 transition-colors cursor-pointer block">
				<span class="font-semibold text-foreground">Import Snapshot</span>
				<span class="block text-xs text-muted-foreground mt-1">Upload a JSON backup file</span>
				<input type="file" accept=".json" class="hidden" onchange={importFile} />
			</label>
		</div>

	{:else if step === 'recover'}
		<h2 class="text-xl font-bold text-primary mb-4">Recover Wallet</h2>
		<p class="text-sm text-muted-foreground mb-4">
			Enter your master secret (64 hex characters). The wallet will scan the server for your webcash.
		</p>
		<textarea
			bind:value={recoverInput}
			placeholder="64-character hex master secret..."
			class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono h-20 resize-none mb-4"
			autocomplete="off"
			spellcheck="false"
		></textarea>
		<div class="flex gap-2">
			<button onclick={() => { step = 'choose'; error = '' }}
				class="flex-1 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">
				Back
			</button>
			<button onclick={recoverFromSecret}
				class="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
				disabled={loading || recoverInput.trim().length !== 64}>
				{loading ? 'Recovering...' : 'Recover'}
			</button>
		</div>

	{:else if step === 'backup'}
		<h2 class="text-xl font-bold text-primary mb-4">Back Up Your Master Secret</h2>
		<div class="rounded-lg bg-muted/50 border border-warning/30 p-4 mb-4">
			<p class="text-sm font-medium text-warning mb-2">Save this now. It cannot be recovered later.</p>
			<p class="text-xs text-muted-foreground">
				This is the only way to recover your wallet. Store it somewhere safe.
			</p>
		</div>
		<div class="relative">
			<code class="block rounded-lg bg-background border border-border px-3 py-3 text-xs font-mono break-all select-all">
				{masterSecret}
			</code>
			<button onclick={copySecret}
				class="absolute top-2 right-2 rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80 transition-colors">
				Copy
			</button>
		</div>
		<button onclick={finishSetup}
			class="w-full mt-6 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
			I've Saved It — Continue
		</button>
	{/if}

	{#if error}
		<div class="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
			{error}
		</div>
	{/if}
</div>
