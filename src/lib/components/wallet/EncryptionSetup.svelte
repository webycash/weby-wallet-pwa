<script lang="ts">
	import { encryptionType, setEncryptionType, type EncryptionType } from '$lib/stores/settings.svelte';
	import { isWebAuthnAvailable, encryptWithPasskey, encryptWithPassword } from '$lib/core/encryption';
	import { exportWalletSnapshot } from '$lib/stores/wallet.svelte';
	import { Lock, Fingerprint, ShieldOff } from '@lucide/svelte';
	import Button from '$lib/components/ui/button/button.svelte';

	let current = $state<EncryptionType>(encryptionType());
	let showPasswordForm = $state(false);
	let password = $state('');
	let passwordConfirm = $state('');
	let loading = $state(false);
	let error = $state('');
	let success = $state('');

	const webauthnAvailable = isWebAuthnAvailable();

	const selectNone = async () => {
		loading = true;
		error = '';
		localStorage.removeItem('weby_encrypted_wallet');
		localStorage.removeItem('weby_passkey_credential');
		setEncryptionType('none');
		current = 'none';
		showPasswordForm = false;
		success = 'Encryption disabled';
		setTimeout(() => { success = ''; }, 3000);
		loading = false;
	};

	const selectPassword = () => {
		showPasswordForm = true;
		error = '';
		success = '';
	};

	const confirmPassword = async () => {
		if (!password || password.length < 8) { error = 'Password must be at least 8 characters'; return; }
		if (password !== passwordConfirm) { error = 'Passwords do not match'; return; }

		loading = true;
		error = '';
		try {
			const snapshot = await exportWalletSnapshot();
			const encrypted = await encryptWithPassword(snapshot, password);
			localStorage.setItem('weby_encrypted_wallet', encrypted);
			localStorage.removeItem('weby_passkey_credential');
			setEncryptionType('password');
			current = 'password';
			showPasswordForm = false;
			password = '';
			passwordConfirm = '';
			success = 'Wallet encrypted with password';
			setTimeout(() => { success = ''; }, 3000);
		} catch (e: any) {
			error = e.message || 'Encryption failed';
		}
		loading = false;
	};

	const selectPasskey = async () => {
		loading = true;
		error = '';
		try {
			const snapshot = await exportWalletSnapshot();
			const result = await encryptWithPasskey(snapshot);
			localStorage.setItem('weby_encrypted_wallet', result.encrypted);
			localStorage.setItem('weby_passkey_credential', result.credentialId);
			setEncryptionType('passkey');
			current = 'passkey';
			showPasswordForm = false;
			success = 'Wallet encrypted with passkey';
			setTimeout(() => { success = ''; }, 3000);
		} catch (e: any) {
			error = e.message || 'Passkey setup failed';
		}
		loading = false;
	};
</script>

<div>
	<p class="text-xs font-medium text-muted-foreground mb-2">Encryption</p>
	<div class="grid gap-2">
		<button onclick={selectNone}
			disabled={loading}
			class="flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all
				{current === 'none'
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-border hover:bg-muted'}">
			<ShieldOff class="w-4 h-4 shrink-0" />
			<div class="flex-1 min-w-0">
				<p class="text-sm font-medium">No encryption</p>
				<p class="text-[11px] {current === 'none' ? 'opacity-80' : 'text-muted-foreground'}">Wallet data stored unencrypted</p>
			</div>
			{#if current === 'none'}
				<div class="w-2 h-2 rounded-full bg-primary-foreground shrink-0"></div>
			{/if}
		</button>

		<button onclick={selectPassword}
			disabled={loading}
			class="flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all
				{current === 'password'
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-border hover:bg-muted'}">
			<Lock class="w-4 h-4 shrink-0" />
			<div class="flex-1 min-w-0">
				<p class="text-sm font-medium">Password</p>
				<p class="text-[11px] {current === 'password' ? 'opacity-80' : 'text-muted-foreground'}">Argon2 + AES-256-GCM encryption</p>
			</div>
			{#if current === 'password'}
				<div class="w-2 h-2 rounded-full bg-primary-foreground shrink-0"></div>
			{/if}
		</button>

		{#if webauthnAvailable}
			<button onclick={selectPasskey}
				disabled={loading}
				class="flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all
					{current === 'passkey'
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-border hover:bg-muted'}">
				<Fingerprint class="w-4 h-4 shrink-0" />
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium">Passkey</p>
					<p class="text-[11px] {current === 'passkey' ? 'opacity-80' : 'text-muted-foreground'}">Face ID / Touch ID / fingerprint</p>
				</div>
				{#if current === 'passkey'}
					<div class="w-2 h-2 rounded-full bg-primary-foreground shrink-0"></div>
				{/if}
			</button>
		{/if}
	</div>

	{#if showPasswordForm && current !== 'password'}
		<div class="mt-3 space-y-2">
			<input
				type="password"
				bind:value={password}
				placeholder="Password (min 8 characters)"
				class="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
			/>
			<input
				type="password"
				bind:value={passwordConfirm}
				placeholder="Confirm password"
				class="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
			/>
			<Button class="w-full" onclick={confirmPassword} disabled={loading || !password || password.length < 8}>
				{loading ? 'Encrypting...' : 'Encrypt Wallet'}
			</Button>
		</div>
	{/if}

	{#if error}
		<p class="mt-2 text-sm text-danger-foreground bg-danger rounded-xl px-3 py-2">{error}</p>
	{/if}
	{#if success}
		<p class="mt-2 text-sm text-success-foreground bg-success rounded-xl px-3 py-2">{success}</p>
	{/if}
</div>
