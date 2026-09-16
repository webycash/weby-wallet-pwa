<script lang="ts">
	import { encryptionType, setEncryptionType, type EncryptionType } from '$lib/stores/settings.svelte';
	import { isWebAuthnAvailable } from '$lib/core/encryption';
	import {
		assertEncryptedWalletBlob,
		buildCustodyVault,
		clearSessionSecrets,
		encryptCustodyVaultWithPasskey,
		encryptCustodyVaultWithPassword,
		setSessionPassword
	} from '$lib/core/custody';
	import * as Persistence from '$lib/core/persistence';
	import { exportWalletSnapshot } from '$lib/stores/wallet.svelte';
	import { Lock, Fingerprint, ShieldOff } from '@lucide/svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import SelectionButton from '$lib/components/ui/selection-button.svelte';

	let current = $state<EncryptionType>(encryptionType());
	let showPasswordForm = $state(false);
	let password = $state('');
	let passwordConfirm = $state('');
	let loading = $state(false);
	let error = $state('');
	let success = $state('');

	const webauthnAvailable = isWebAuthnAvailable();

	const selectNone = async () => {
		loading = true; error = '';
		localStorage.removeItem('weby_encrypted_wallet');
		localStorage.removeItem('weby_passkey_credential');
		clearSessionSecrets();
		setEncryptionType('none');
		current = 'none'; showPasswordForm = false;
		success = 'Encryption disabled';
		setTimeout(() => { success = ''; }, 3000);
		loading = false;
	};

	const selectPassword = () => { showPasswordForm = true; error = ''; success = ''; };

	const confirmPassword = async () => {
		if (!password || password.length < 8) { error = 'Password must be at least 8 characters'; return; }
		if (password !== passwordConfirm) { error = 'Passwords do not match'; return; }
		loading = true; error = '';
		try {
			const snapshot = await exportWalletSnapshot();
			const mnemonic = Persistence.getMnemonic();
			if (!mnemonic) throw new Error('custody_vault_missing_mnemonic');
			const vault = buildCustodyVault(mnemonic, snapshot);
			const encrypted = await encryptCustodyVaultWithPassword(vault, password);
			assertEncryptedWalletBlob(encrypted);
			localStorage.setItem('weby_encrypted_wallet', encrypted);
			localStorage.removeItem('weby_passkey_credential');
			setSessionPassword(password);
			Persistence.clearMnemonic();
			setEncryptionType('password');
			current = 'password'; showPasswordForm = false; password = ''; passwordConfirm = '';
			success = 'Wallet encrypted with password';
			setTimeout(() => { success = ''; }, 3000);
		} catch (e: any) { error = e.message || 'Encryption failed'; }
		loading = false;
	};

	const selectPasskey = async () => {
		loading = true; error = '';
		try {
			const snapshot = await exportWalletSnapshot();
			const mnemonic = Persistence.getMnemonic();
			if (!mnemonic) throw new Error('custody_vault_missing_mnemonic');
			const vault = buildCustodyVault(mnemonic, snapshot);
			const result = await encryptCustodyVaultWithPasskey(vault);
			assertEncryptedWalletBlob(result.encrypted);
			localStorage.setItem('weby_encrypted_wallet', result.encrypted);
			localStorage.setItem('weby_passkey_credential', result.credentialId);
			Persistence.clearMnemonic();
			setEncryptionType('passkey');
			current = 'passkey'; showPasswordForm = false;
			success = 'Wallet encrypted with passkey';
			setTimeout(() => { success = ''; }, 3000);
		} catch (e: any) { error = e.message || 'Passkey setup failed'; }
		loading = false;
	};
</script>

<div>
	<p class="text-xs font-medium text-muted-foreground mb-2">Encryption</p>
	<div class="grid gap-2">
		<SelectionButton selected={current === 'none'} disabled={loading} onclick={selectNone}>
			<ShieldOff class="w-4 h-4 shrink-0" />
			<div class="flex-1 min-w-0">
				<p class="text-[14px] font-medium">No encryption</p>
				<p class="text-[13px] {current === 'none' ? 'opacity-80' : 'text-muted-foreground'}">Wallet data stored unencrypted</p>
			</div>
		</SelectionButton>

		<SelectionButton selected={current === 'password'} disabled={loading} onclick={selectPassword}>
			<Lock class="w-4 h-4 shrink-0" />
			<div class="flex-1 min-w-0">
				<p class="text-[14px] font-medium">Password</p>
				<p class="text-[13px] {current === 'password' ? 'opacity-80' : 'text-muted-foreground'}">Argon2 + AES-256-GCM encryption</p>
			</div>
		</SelectionButton>

		{#if webauthnAvailable}
			<SelectionButton selected={current === 'passkey'} disabled={loading} onclick={selectPasskey}>
				<Fingerprint class="w-4 h-4 shrink-0" />
				<div class="flex-1 min-w-0">
					<p class="text-[14px] font-medium">Passkey</p>
					<p class="text-[13px] {current === 'passkey' ? 'opacity-80' : 'text-muted-foreground'}">Face ID / Touch ID / fingerprint</p>
				</div>
			</SelectionButton>
		{/if}
	</div>

	{#if showPasswordForm && current !== 'password'}
		<form onsubmit={(e) => { e.preventDefault(); confirmPassword(); }} class="mt-3 space-y-2">
			<input type="password" autocomplete="off" bind:value={password} placeholder="Password (min 8 characters)"
				class="w-full rounded-full border border-border bg-background px-5 py-3 text-sm focus:outline-none focus:border-primary transition-all" />
			<input type="password" autocomplete="off" bind:value={passwordConfirm} placeholder="Confirm password"
				class="w-full rounded-full border border-border bg-background px-5 py-3 text-sm focus:outline-none focus:border-primary transition-all" />
			<Button type="submit" class="w-full" disabled={loading || !password || password.length < 8}>
				{loading ? 'Encrypting...' : 'Encrypt Wallet'}
			</Button>
		</form>
	{/if}

	{#if error}<p class="mt-2 text-sm text-danger-foreground bg-danger rounded-full px-4 py-2">{error}</p>{/if}
	{#if success}<p class="mt-2 text-sm text-success-foreground bg-success rounded-full px-4 py-2">{success}</p>{/if}
</div>
