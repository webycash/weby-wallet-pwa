<script lang="ts">
	import { onMount } from 'svelte';
	import { encryptionType } from '$lib/stores/settings.svelte';
	import { decryptWithPasskey, decryptWithPassword } from '$lib/core/encryption';
	import { importWalletSnapshot } from '$lib/stores/wallet.svelte';
	import type { WalletSnapshot } from '$lib/core/types';
	import { Lock, Fingerprint } from '@lucide/svelte';

	let { onUnlock }: { onUnlock: () => void } = $props();

	const encType = encryptionType();
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	const tryLoadSnapshot = (encrypted: string): WalletSnapshot | null => {
		// Try parsing as plain JSON snapshot (auto-saved format)
		try {
			const parsed = JSON.parse(encrypted);
			if (parsed.master_secret) return parsed as WalletSnapshot;
		} catch {}
		return null;
	};

	const unlockPasskey = async () => {
		loading = true;
		error = '';
		try {
			const encrypted = localStorage.getItem('weby_encrypted_wallet');
			if (!encrypted) { onUnlock(); return; }

			// Try plain JSON first (auto-saved by Dashboard)
			const plain = tryLoadSnapshot(encrypted);
			if (plain) {
				await importWalletSnapshot(plain);
				onUnlock();
				return;
			}

			// Try credential-based password decrypt (auto-saved with credentialId as password)
			const credentialId = localStorage.getItem('weby_passkey_credential');
			if (credentialId) {
				try {
					const snapshot = await decryptWithPassword(encrypted, credentialId);
					await importWalletSnapshot(snapshot);
					onUnlock();
					return;
				} catch {}
			}

			// Fall back to full WebAuthn ceremony
			const snapshot = await decryptWithPasskey(encrypted);
			await importWalletSnapshot(snapshot);
			onUnlock();
		} catch (e: any) {
			error = e.message || 'Authentication failed';
		}
		loading = false;
	};

	const unlockWithPassword = async () => {
		loading = true;
		error = '';
		try {
			const encrypted = localStorage.getItem('weby_encrypted_wallet');
			if (!encrypted) { onUnlock(); return; }

			// Try plain JSON first
			const plain = tryLoadSnapshot(encrypted);
			if (plain) {
				await importWalletSnapshot(plain);
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

	onMount(() => {
		if (encType === 'passkey') unlockPasskey();
	});
</script>

<div class="container mx-auto px-4 py-16 max-w-sm text-center">
	<div class="rounded-3xl border-2 border-border bg-card p-8 space-y-6">
		{#if encType === 'passkey'}
			<div class="rounded-full bg-primary w-16 h-16 flex items-center justify-center mx-auto">
				<Fingerprint class="w-8 h-8 text-primary" />
			</div>
			<div>
				<h2 class="text-lg font-bold text-foreground">Unlock Wallet</h2>
				<p class="text-sm text-muted-foreground mt-1">Authenticate to access your wallet</p>
			</div>
			<button onclick={unlockPasskey}
				class="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
				disabled={loading}>
				{loading ? 'Authenticating...' : 'Unlock with Passkey'}
			</button>
		{:else}
			<div class="rounded-full bg-primary w-16 h-16 flex items-center justify-center mx-auto">
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
				class="w-full rounded-full border-2 border-input bg-background px-5 py-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
				onkeydown={(e) => { if (e.key === 'Enter') unlockWithPassword(); }}
			/>
			<button onclick={unlockWithPassword}
				class="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
				disabled={loading || !password}>
				{loading ? 'Decrypting...' : 'Unlock'}
			</button>
		{/if}

		{#if error}
			<p class="text-sm text-red-500">{error}</p>
		{/if}
	</div>
</div>
