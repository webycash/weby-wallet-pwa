<script lang="ts">
	import { setupWallet, importWalletSnapshot, recoverWallet } from '$lib/stores/wallet.svelte';
	import { markWalletCreated, setEncryptionType, type EncryptionType } from '$lib/stores/settings.svelte';
	import { getNetwork } from '$lib/stores/network.svelte';
	import { isWebAuthnAvailable } from '$lib/core/encryption';
	import type { WalletSnapshot } from '$lib/core/types';
	import { Plus, KeyRound, Upload, Lock, Fingerprint, ShieldOff, Copy, Check } from '@lucide/svelte';

	type Step = 'choose' | 'recover' | 'encrypt' | 'backup';

	let step = $state<Step>('choose');
	let masterSecret = $state('');
	let recoverInput = $state('');
	let error = $state('');
	let loading = $state(false);
	let copied = $state(false);
	let selectedEncryption = $state<EncryptionType>('none');

	const webauthnAvailable = isWebAuthnAvailable();

	const createNew = async () => {
		loading = true;
		error = '';
		const result = await setupWallet();
		if (result.ok) {
			masterSecret = result.value;
			step = 'encrypt';
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
			step = 'encrypt';
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
				masterSecret = snapshot.master_secret;
				step = 'encrypt';
			} else {
				error = result.error;
			}
		} catch (e) {
			error = `Invalid file: ${e}`;
		}
		loading = false;
	};

	const confirmEncryption = () => {
		setEncryptionType(selectedEncryption);
		step = 'backup';
	};

	const finish = () => {
		markWalletCreated();
		window.location.reload();
	};

	const copySecret = async () => {
		await navigator.clipboard.writeText(masterSecret);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	};
</script>

<div class="container mx-auto px-4 py-8 max-w-lg">
	{#if step === 'choose'}
		<div class="text-center mb-8">
			<h1 class="text-2xl font-bold text-foreground mb-2">Create Your Wallet</h1>
			<p class="text-sm text-muted-foreground">All data stays on your device. Private by default.</p>
		</div>

		<div class="space-y-3">
			<button onclick={createNew}
				class="w-full flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left hover:border-primary/30 hover:bg-primary/5 transition-all"
				disabled={loading}>
				<div class="rounded-xl bg-primary/10 p-2.5">
					<Plus class="w-5 h-5 text-primary" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">Create New Wallet</span>
					<span class="block text-xs text-muted-foreground mt-0.5">Generate a fresh master secret</span>
				</div>
			</button>

			<button onclick={() => { step = 'recover' }}
				class="w-full flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left hover:border-primary/30 hover:bg-primary/5 transition-all">
				<div class="rounded-xl bg-violet-500/10 p-2.5">
					<KeyRound class="w-5 h-5 text-violet-500" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">Recover from Secret</span>
					<span class="block text-xs text-muted-foreground mt-0.5">Enter your 64-character hex master secret</span>
				</div>
			</button>

			<label class="w-full flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer">
				<div class="rounded-xl bg-cyan-500/10 p-2.5">
					<Upload class="w-5 h-5 text-cyan-500" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">Import Backup</span>
					<span class="block text-xs text-muted-foreground mt-0.5">Upload a JSON snapshot file</span>
				</div>
				<input type="file" accept=".json" class="hidden" onchange={importFile} />
			</label>
		</div>

	{:else if step === 'recover'}
		<h2 class="text-xl font-bold text-foreground mb-2">Recover Wallet</h2>
		<p class="text-sm text-muted-foreground mb-4">Enter your master secret. We'll scan the server for your webcash.</p>
		<textarea
			bind:value={recoverInput}
			placeholder="64-character hex master secret..."
			class="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm font-mono h-24 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
			autocomplete="off"
			spellcheck="false"
		></textarea>
		<div class="flex gap-2 mt-4">
			<button onclick={() => { step = 'choose'; error = '' }}
				class="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-all">
				Back
			</button>
			<button onclick={recoverFromSecret}
				class="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40"
				disabled={loading || recoverInput.trim().length !== 64}>
				{loading ? 'Scanning...' : 'Recover'}
			</button>
		</div>

	{:else if step === 'encrypt'}
		<h2 class="text-xl font-bold text-foreground mb-2">Protect Your Wallet</h2>
		<p class="text-sm text-muted-foreground mb-5">Choose how to encrypt your wallet data.</p>

		<div class="space-y-2 mb-5">
			<button onclick={() => selectedEncryption = 'none'}
				class="w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-all
					{selectedEncryption === 'none' ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border'}">
				<ShieldOff class="w-5 h-5 {selectedEncryption === 'none' ? 'text-primary' : 'text-muted-foreground'}" />
				<div class="flex-1">
					<p class="text-sm font-medium">No encryption</p>
					<p class="text-[11px] text-muted-foreground">Quick access, less secure</p>
				</div>
				{#if selectedEncryption === 'none'}<div class="w-2 h-2 rounded-full bg-primary"></div>{/if}
			</button>

			<button onclick={() => selectedEncryption = 'password'}
				class="w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-all
					{selectedEncryption === 'password' ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border'}">
				<Lock class="w-5 h-5 {selectedEncryption === 'password' ? 'text-primary' : 'text-muted-foreground'}" />
				<div class="flex-1">
					<p class="text-sm font-medium">Password</p>
					<p class="text-[11px] text-muted-foreground">Argon2 + AES-256-GCM — enter password each time</p>
				</div>
				{#if selectedEncryption === 'password'}<div class="w-2 h-2 rounded-full bg-primary"></div>{/if}
			</button>

			{#if webauthnAvailable}
				<button onclick={() => selectedEncryption = 'passkey'}
					class="w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-all
						{selectedEncryption === 'passkey' ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border'}">
					<Fingerprint class="w-5 h-5 {selectedEncryption === 'passkey' ? 'text-primary' : 'text-muted-foreground'}" />
					<div class="flex-1">
						<p class="text-sm font-medium">Passkey</p>
						<p class="text-[11px] text-muted-foreground">Face ID / Touch ID / fingerprint — biometric unlock</p>
					</div>
					{#if selectedEncryption === 'passkey'}<div class="w-2 h-2 rounded-full bg-primary"></div>{/if}
				</button>
			{/if}
		</div>

		<button onclick={confirmEncryption}
			class="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
			Continue
		</button>

	{:else if step === 'backup'}
		<h2 class="text-xl font-bold text-foreground mb-2">Back Up Your Secret</h2>
		<div class="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 mb-5">
			<p class="text-sm font-medium text-amber-600 dark:text-amber-400">This is the only way to recover your wallet.</p>
			<p class="text-xs text-muted-foreground mt-1">Write it down or save it somewhere secure. It cannot be recovered later.</p>
		</div>
		<div class="relative rounded-2xl border border-border bg-muted/30 p-4">
			<code class="text-xs font-mono break-all select-all text-foreground leading-relaxed">
				{masterSecret}
			</code>
			<button onclick={copySecret}
				class="absolute top-3 right-3 rounded-lg p-2 bg-card border border-border/50 hover:border-border transition-all">
				{#if copied}
					<Check class="w-3.5 h-3.5 text-emerald-500" />
				{:else}
					<Copy class="w-3.5 h-3.5 text-muted-foreground" />
				{/if}
			</button>
		</div>
		<button onclick={finish}
			class="w-full mt-5 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
			I've Saved It — Open Wallet
		</button>
	{/if}

	{#if error}
		<div class="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
			{error}
		</div>
	{/if}
</div>
