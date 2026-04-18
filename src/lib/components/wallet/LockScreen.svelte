<script lang="ts">
	import { onMount } from 'svelte';
	import { encryptionType } from '$lib/stores/settings.svelte';
	import { resetWallet } from '$lib/core/reset';
	import { decryptWithPasskey, decryptWithPassword } from '$lib/core/encryption';
	import { importWalletSnapshot } from '$lib/stores/wallet.svelte';
	import type { WalletSnapshot } from '$lib/core/types';
	import { Lock, Fingerprint, KeyRound } from '@lucide/svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';

	let { onUnlock }: { onUnlock: () => void } = $props();

	const encType = encryptionType();
	let password = $state('');
	let error = $state('');
	let loading = $state(false);
	let autofilled = $state(false);
	let passwordEl = $state<HTMLInputElement>();

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
		// Read value directly from DOM in case of autofill that didn't trigger bind
		const pwd = passwordEl?.value || password;
		if (!pwd) return;
		loading = true;
		error = '';
		try {
			const encrypted = localStorage.getItem('weby_encrypted_wallet');
			if (!encrypted) { onUnlock(); return; }

			const plain = tryLoadSnapshot(encrypted);
			if (plain) { await importWalletSnapshot(plain); onUnlock(); return; }

			const snapshot = await decryptWithPassword(encrypted, pwd);
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

	const detectAutofill = () => {
		// Browsers apply :-webkit-autofill; check after a short delay
		setTimeout(() => {
			if (passwordEl) {
				try {
					if (passwordEl.matches(':-webkit-autofill')) {
						autofilled = true;
					}
				} catch {}
				// Fallback: if the field has a value we didn't set
				if (!autofilled && passwordEl.value && !password) {
					autofilled = true;
				}
			}
		}, 600);
	};

	onMount(() => {
		if (encType === 'passkey') unlockPasskey();
		else detectAutofill();
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
				<form onsubmit={(e) => { e.preventDefault(); unlockWithPassword(); }} action="https://weby.cash/wallet" method="POST" class="space-y-4">
					<input type="text" name="username" autocomplete="username" value="webycash-encrypt-password" class="hidden" tabindex="-1" aria-hidden="true" />
					<div>
						<input
							bind:this={passwordEl}
							type="password"
							name="password"
							autocomplete="current-password"
							bind:value={password}
							oninput={() => { autofilled = false; }}
							placeholder="Password"
							class="w-full rounded-full border border-border bg-background px-5 py-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
						/>
						{#if autofilled}
							<p class="flex items-center justify-center gap-1.5 text-xs text-primary mt-2">
								<KeyRound class="w-3 h-3" /> Filled from password manager
							</p>
						{/if}
					</div>
					<Button type="submit" class="w-full" disabled={loading}>
						{loading ? 'Decrypting...' : 'Unlock'}
					</Button>
				</form>
			{/if}

			{#if error}
				<p class="text-sm text-danger-foreground bg-danger rounded-xl px-3 py-2">{error}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<button onclick={handleReset} class="text-xs text-muted-foreground hover:text-danger transition-colors">
		Reset wallet
	</button>
</div>
