<script lang="ts">
	import { encryptionType } from '$lib/stores/settings.svelte';
	import { decryptWithPasskey, decryptWithPassword } from '$lib/core/encryption';
	import { importWalletSnapshot } from '$lib/stores/wallet.svelte';
	import { Lock, Fingerprint } from '@lucide/svelte';

	let { onUnlock }: { onUnlock: () => void } = $props();

	const encType = encryptionType();
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	const unlockPasskey = async () => {
		loading = true;
		error = '';
		try {
			const encrypted = localStorage.getItem('weby_encrypted_wallet');
			if (!encrypted) {
				// No encrypted data — wallet was set to passkey but never encrypted properly
				onUnlock();
				return;
			}
			const snapshot = await decryptWithPasskey(encrypted);
			await importWalletSnapshot(snapshot);
			onUnlock();
		} catch (e: any) {
			error = e.message || 'Authentication failed';
		}
		loading = false;
	};

	const unlockPassword = async () => {
		loading = true;
		error = '';
		try {
			const encrypted = localStorage.getItem('weby_encrypted_wallet');
			if (!encrypted) {
				onUnlock();
				return;
			}
			const snapshot = await decryptWithPassword(encrypted, password);
			await importWalletSnapshot(snapshot);
			onUnlock();
		} catch (e: any) {
			error = 'Wrong password';
		}
		loading = false;
	};

	// Auto-trigger passkey on mount
	import { onMount } from 'svelte';
	onMount(() => {
		if (encType === 'passkey') unlockPasskey();
	});
</script>

<div class="container mx-auto px-4 py-16 max-w-sm text-center">
	<div class="rounded-3xl border border-border bg-card p-8 space-y-6">
		{#if encType === 'passkey'}
			<div class="rounded-full bg-primary/10 w-16 h-16 flex items-center justify-center mx-auto">
				<Fingerprint class="w-8 h-8 text-primary" />
			</div>
			<div>
				<h2 class="text-lg font-bold text-foreground">Unlock Wallet</h2>
				<p class="text-sm text-muted-foreground mt-1">Authenticate to access your wallet</p>
			</div>
			<button onclick={unlockPasskey}
				class="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40"
				disabled={loading}>
				{loading ? 'Authenticating...' : 'Unlock with Passkey'}
			</button>
		{:else}
			<div class="rounded-full bg-primary/10 w-16 h-16 flex items-center justify-center mx-auto">
				<Lock class="w-8 h-8 text-primary" />
			</div>
			<div>
				<h2 class="text-lg font-bold text-foreground">Unlock Wallet</h2>
				<p class="text-sm text-muted-foreground mt-1">Enter your password</p>
			</div>
			<input
				type="password"
				bind:value={password}
				placeholder="Password"
				class="w-full rounded-full border border-input bg-background px-5 py-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
				onkeydown={(e) => { if (e.key === 'Enter') unlockPassword(); }}
			/>
			<button onclick={unlockPassword}
				class="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40"
				disabled={loading || !password}>
				{loading ? 'Decrypting...' : 'Unlock'}
			</button>
		{/if}

		{#if error}
			<p class="text-sm text-red-500">{error}</p>
		{/if}
	</div>
</div>
