<script lang="ts">
	import { onMount } from 'svelte';
	import { encryptionType } from '$lib/stores/settings.svelte';
	import { resetWallet } from '$lib/core/reset';
	import { decryptWithPasskey, decryptWithPassword } from '$lib/core/encryption';
	import { importWalletSnapshot } from '$lib/stores/wallet.svelte';
	import type { WalletSnapshot } from '$lib/core/types';
	import { Lock, Fingerprint, Trash2 } from '@lucide/svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';

	let { onUnlock }: { onUnlock: () => void } = $props();

	const encType = encryptionType();
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	const tryLoadSnapshot = (encrypted: string): WalletSnapshot | null => {
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

			const plain = tryLoadSnapshot(encrypted);
			if (plain) { await importWalletSnapshot(plain); onUnlock(); return; }

			const credentialId = localStorage.getItem('weby_passkey_credential');
			if (credentialId) {
				try {
					const snapshot = await decryptWithPassword(encrypted, credentialId);
					await importWalletSnapshot(snapshot); onUnlock(); return;
				} catch {}
			}

			const snapshot = await decryptWithPasskey(encrypted);
			await importWalletSnapshot(snapshot); onUnlock();
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

			const plain = tryLoadSnapshot(encrypted);
			if (plain) { await importWalletSnapshot(plain); onUnlock(); return; }

			const snapshot = await decryptWithPassword(encrypted, password);
			await importWalletSnapshot(snapshot); onUnlock();
		} catch (e: any) {
			error = 'Wrong password';
		}
		loading = false;
	};

	const handleReset = async () => {
		if (!confirm('Delete wallet and start fresh? All data will be lost.')) return;
		await resetWallet();
		setTimeout(() => { window.location.href = window.location.pathname; }, 100);
	};

	onMount(() => {
		if (encType === 'passkey') unlockPasskey();
	});
</script>

<div class="container mx-auto px-4 py-16 max-w-sm text-center space-y-4">
	<Card.Root>
		<Card.Content class="p-8 space-y-6">
			{#if encType === 'passkey'}
				<div class="rounded-full bg-primary w-16 h-16 flex items-center justify-center mx-auto">
					<Fingerprint class="w-8 h-8 text-primary-foreground" />
				</div>
				<div>
					<h2 class="text-lg font-bold text-foreground">Unlock Wallet</h2>
					<p class="text-sm text-muted-foreground mt-1">Authenticate to access your wallet</p>
				</div>
				<Button class="w-full" onclick={unlockPasskey} disabled={loading}>
					{loading ? 'Authenticating...' : 'Unlock with Passkey'}
				</Button>
			{:else}
				<div class="rounded-full bg-primary w-16 h-16 flex items-center justify-center mx-auto">
					<Lock class="w-8 h-8 text-primary-foreground" />
				</div>
				<div>
					<h2 class="text-lg font-bold text-foreground">Unlock Wallet</h2>
					<p class="text-sm text-muted-foreground mt-1">Enter your password</p>
				</div>
				<input
					type="password"
					bind:value={password}
					placeholder="Password"
					class="w-full rounded-full border-2 border-border bg-background px-5 py-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
					onkeydown={(e) => { if (e.key === 'Enter') unlockWithPassword(); }}
				/>
				<Button class="w-full" onclick={unlockWithPassword} disabled={loading || !password}>
					{loading ? 'Decrypting...' : 'Unlock'}
				</Button>
			{/if}

			{#if error}
				<p class="text-sm text-danger-foreground bg-danger rounded-xl px-3 py-2">{error}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Button variant="destructive" class="w-full" onclick={handleReset}>
		<Trash2 class="w-4 h-4" /> Reset Wallet
	</Button>
	<p class="text-xs text-muted-foreground">Forgot your password? Reset deletes all wallet data.</p>
</div>
