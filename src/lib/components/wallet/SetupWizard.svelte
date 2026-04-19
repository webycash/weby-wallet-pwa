<script lang="ts">
	import { setupWallet, setupFromMnemonic, importWalletSnapshot, recoverWallet } from '$lib/stores/wallet.svelte';
	import { markWalletCreated, setEncryptionType, type EncryptionType } from '$lib/stores/settings.svelte';
	import { isWebAuthnAvailable, encryptWithPasskey, encryptWithPassword } from '$lib/core/encryption';
	import type { WalletSnapshot } from '$lib/core/types';
	import { exportWalletSnapshot } from '$lib/stores/wallet.svelte';
	import { Plus, KeyRound, Upload, Lock, Fingerprint, ShieldOff, Copy, Check, ScanLine } from '@lucide/svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import SelectionButton from '$lib/components/ui/selection-button.svelte';

	type Step = 'choose' | 'recover' | 'qrscan' | 'encrypt' | 'backup';

	let step = $state<Step>('choose');
	let masterSecret = $state('');
	let recoverInput = $state('');
	let error = $state('');
	let loading = $state(false);
	let copied = $state(false);
	let saved = $state(false);
	let selectedEncryption = $state<EncryptionType>('none');
	let encPassword = $state('');
	let encPasswordConfirm = $state('');
	let encLoading = $state(false);
	let encError = $state('');

	const webauthnAvailable = isWebAuthnAvailable();
	let videoEl = $state<HTMLVideoElement>();
	let canvasEl = $state<HTMLCanvasElement>();
	let cameraStream: MediaStream | null = null;
	let scanTimer: ReturnType<typeof setInterval> | null = null;
	let scanStatus = $state('Starting camera...');

	const startCamera = async () => {
		try {
			cameraStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment', width: { ideal: 480 }, height: { ideal: 480 } }
			});
			if (videoEl) {
				videoEl.srcObject = cameraStream;
				await videoEl.play();
			}
			scanStatus = 'Point camera at QR code';

			const jsQR = (await import('jsqr')).default;

			scanTimer = setInterval(() => {
				if (!cameraStream || !videoEl || !canvasEl || videoEl.readyState < 2) return;
				const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
				if (!ctx) return;

				const w = videoEl.videoWidth;
				const h = videoEl.videoHeight;
				if (w === 0 || h === 0) return;

				canvasEl.width = w;
				canvasEl.height = h;
				ctx.drawImage(videoEl, 0, 0, w, h);

				const imageData = ctx.getImageData(0, 0, w, h);
				const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });

				if (code?.data) {
					const value = code.data.trim();
					if (/^[0-9a-f]{64}$/i.test(value)) {
						scanStatus = 'QR code found!';
						recoverInput = value;
						stopCamera();
						recoverFromSecret();
					}
				}
			}, 250);
		} catch (e) {
			scanStatus = 'Camera not available. Paste the secret below.';
		}
	};

	const stopCamera = () => {
		if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
		cameraStream?.getTracks().forEach(t => t.stop());
		cameraStream = null;
	};

	$effect(() => {
		if (step === 'qrscan') startCamera();
		return () => stopCamera();
	});

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
		// Detect format: hex (64 chars) or mnemonic (words with spaces)
		let mnemonic: string;
		if (/^[0-9a-f]{64}$/i.test(trimmed)) {
			const { getWasm } = await import('$lib/core/wasm');
			const wasm = await getWasm();
			mnemonic = wasm.mnemonic_from_hex(trimmed);
		} else {
			mnemonic = trimmed;
		}
		const setupResult = await setupFromMnemonic(mnemonic);
		if (!setupResult.ok) { error = setupResult.error; loading = false; return; }
		masterSecret = setupResult.value;

		const result = await recoverWallet(20);
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
				// Auto-recover to find any webcash on the server
				await recoverWallet(20);
				step = 'encrypt';
			} else {
				error = result.error;
			}
		} catch (e) {
			error = `Invalid file: ${e}`;
		}
		loading = false;
	};

	const confirmEncryption = async () => {
		encError = '';
		encLoading = true;

		try {
			if (selectedEncryption === 'passkey') {
				const snapshot = await exportWalletSnapshot();
				const result = await encryptWithPasskey(snapshot);
				localStorage.setItem('weby_encrypted_wallet', result.encrypted);
				localStorage.setItem('weby_passkey_credential', result.credentialId);
			} else if (selectedEncryption === 'password') {
				if (!encPassword || encPassword !== encPasswordConfirm) {
					encError = 'Passwords do not match';
					encLoading = false;
					return;
				}
				if (encPassword.length < 8) {
					encError = 'Password must be at least 8 characters';
					encLoading = false;
					return;
				}
				const snapshot = await exportWalletSnapshot();
				const encrypted = await encryptWithPassword(snapshot, encPassword);
				localStorage.setItem('weby_encrypted_wallet', encrypted);
			}

			setEncryptionType(selectedEncryption);
			step = 'backup';
		} catch (e: any) {
			encError = e.message || 'Encryption failed';
		}

		encLoading = false;
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

	const saveToPasswordManager = async () => {
		try {
			if ('PasswordCredential' in window) {
				// @ts-ignore — PasswordCredential constructor
				const cred = new PasswordCredential({
					id: 'webycash-master-secret',
					name: 'Webycash Master Secret',
					password: masterSecret,
					origin: 'https://weby.cash',
				});
				await navigator.credentials.store(cred);
			} else {
				// Fallback: hidden form triggers browser "Save password?" prompt
				const form = document.createElement('form');
				form.style.position = 'fixed';
				form.style.top = '-9999px';
				form.method = 'POST';
				form.action = 'https://weby.cash/wallet';

				const userInput = document.createElement('input');
				userInput.type = 'text';
				userInput.name = 'username';
				userInput.autocomplete = 'username';
				userInput.value = 'webycash-master-secret';

				const passInput = document.createElement('input');
				passInput.type = 'password';
				passInput.name = 'password';
				passInput.autocomplete = 'new-password';
				passInput.value = masterSecret;

				form.appendChild(userInput);
				form.appendChild(passInput);
				document.body.appendChild(form);

				form.addEventListener('submit', (e) => { e.preventDefault(); });
				form.requestSubmit();
				setTimeout(() => { document.body.removeChild(form); }, 2000);
			}
			saved = true;
			setTimeout(() => { saved = false; }, 3000);
		} catch {
			await navigator.clipboard.writeText(masterSecret);
			saved = true;
			setTimeout(() => { saved = false; }, 3000);
		}
	};
</script>

<div class="container mx-auto px-4 py-8 max-w-lg">
	{#if step === 'choose'}
		<div class="text-center mb-8">
			<h1 class="text-2xl font-bold text-foreground mb-2">Create Your Wallet</h1>
			<p class="text-sm text-muted-foreground">All data stays on your device. Private by default.</p>
			<a href="https://github.com/webycash/weby-wallet-pwa" target="_blank" rel="noopener noreferrer"
				class="inline-flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-all">
				Open source
			</a>
		</div>

		<div class="space-y-3">
			<button onclick={createNew}
				class="w-full flex items-center gap-4 rounded-full border border-border bg-card p-5 text-left hover:border-primary hover:bg-muted transition-all"
				disabled={loading}>
				<div class="rounded-full bg-primary p-2.5" class:animate-pulse={loading}>
					<Plus class="w-5 h-5 text-primary-foreground" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">{loading ? 'Creating...' : 'Create New Wallet'}</span>
					<span class="block text-xs text-muted-foreground mt-0.5">Generate a fresh master secret</span>
				</div>
			</button>

			<button onclick={() => { step = 'recover' }}
				class="w-full flex items-center gap-4 rounded-full border border-border bg-card p-5 text-left hover:border-primary hover:bg-muted transition-all">
				<div class="rounded-full bg-primary p-2.5">
					<KeyRound class="w-5 h-5 text-primary-foreground" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">Recover</span>
					<span class="block text-xs text-muted-foreground mt-0.5">From mnemonic or hex secret</span>
				</div>
			</button>

			<label class="w-full flex items-center gap-4 rounded-full border border-border bg-card p-5 text-left hover:border-primary hover:bg-muted transition-all cursor-pointer">
				<div class="rounded-full bg-primary p-2.5">
					<Upload class="w-5 h-5 text-primary-foreground" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">Import</span>
					<span class="block text-xs text-muted-foreground mt-0.5">From JSON backup file</span>
				</div>
				<input type="file" accept=".json" class="hidden" onchange={importFile} />
			</label>

			<button onclick={() => { step = 'qrscan' }}
				class="w-full flex items-center gap-4 rounded-full border border-border bg-card p-5 text-left hover:border-primary hover:bg-muted transition-all">
				<div class="rounded-full bg-primary p-2.5">
					<ScanLine class="w-5 h-5 text-primary-foreground" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">Scan QR</span>
					<span class="block text-xs text-muted-foreground mt-0.5">Import from another device</span>
				</div>
			</button>
		</div>

	{:else if step === 'recover'}
		<h2 class="text-xl font-bold text-foreground mb-2">Recover Wallet</h2>
		<p class="text-sm text-muted-foreground mb-4">Enter your master secret. We'll scan the server for your webcash.</p>
		<textarea
			bind:value={recoverInput}
			placeholder="24 words or 64-char hex..."
			class="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm font-mono h-24 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
			autocomplete="off"
			spellcheck="false"
		></textarea>
		<div class="flex gap-2 mt-4">
			<button onclick={() => { step = 'choose'; error = '' }}
				class="flex-1 rounded-full border border-border px-4 py-3 text-sm font-medium hover:bg-muted transition-all">
				Back
			</button>
			<button onclick={recoverFromSecret}
				class="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
				class:animate-pulse={loading}
			disabled={loading || (recoverInput.trim().length < 10)}>
				{loading ? 'Scanning...' : 'Recover'}
			</button>
		</div>

	{:else if step === 'qrscan'}
		<h2 class="text-xl font-bold text-foreground mb-2">Scan QR Code</h2>
		<p class="text-sm text-muted-foreground mb-4">
			Open your wallet on the other device, go to Settings > QR Export, and scan the code with your camera.
		</p>
		<div class="rounded-2xl border border-border overflow-hidden bg-black aspect-square relative mb-4 max-w-[320px] mx-auto">
			<video bind:this={videoEl} autoplay playsinline muted class="w-full h-full object-cover"></video>
			<canvas bind:this={canvasEl} class="hidden"></canvas>
			<div class="absolute inset-0 pointer-events-none">
				<div class="absolute inset-[12%] border border-primary rounded-2xl"></div>
				<div class="absolute inset-[12%] border border-primary rounded-2xl animate-pulse"></div>
			</div>
			<div class="absolute bottom-3 left-0 right-0 text-center">
				<span class="text-xs text-white bg-black backdrop-blur-sm px-3 py-1.5 rounded-full">{scanStatus}</span>
			</div>
		</div>
		<p class="text-xs text-muted-foreground text-center mb-3">
			Or paste the master secret manually:
		</p>
		<textarea
			bind:value={recoverInput}
			placeholder="24 words or 64-char hex..."
			class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-mono h-16 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
			autocomplete="off"
			spellcheck="false"
		></textarea>
		<div class="flex gap-2 mt-4">
			<button onclick={() => { stopCamera(); step = 'choose'; error = '' }}
				class="flex-1 rounded-full border border-border px-4 py-3 text-sm font-medium hover:bg-muted transition-all">
				Back
			</button>
			<button onclick={recoverFromSecret}
				class="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary transition-all disabled:opacity-40"
				disabled={loading || (recoverInput.trim().length < 10)}>
				{loading ? 'Importing...' : 'Import'}
			</button>
		</div>

	{:else if step === 'encrypt'}
		<h2 class="text-xl font-bold text-foreground mb-2">Protect Your Wallet</h2>
		<p class="text-sm text-muted-foreground mb-5">Choose how to encrypt your wallet data.</p>

		<div class="space-y-2 mb-5">
			<SelectionButton selected={selectedEncryption === 'none'} onclick={() => selectedEncryption = 'none'}>
				<ShieldOff class="w-5 h-5 shrink-0" />
				<div class="flex-1">
					<p class="text-sm font-medium">No encryption</p>
					<p class="text-[11px] {selectedEncryption === 'none' ? 'opacity-80' : 'text-muted-foreground'}">Quick access, less secure</p>
				</div>
			</SelectionButton>

			<SelectionButton selected={selectedEncryption === 'password'} onclick={() => selectedEncryption = 'password'}>
				<Lock class="w-5 h-5 shrink-0" />
				<div class="flex-1">
					<p class="text-sm font-medium">Password</p>
					<p class="text-[11px] {selectedEncryption === 'password' ? 'opacity-80' : 'text-muted-foreground'}">Argon2 + AES-256-GCM — enter password each time</p>
				</div>
			</SelectionButton>

			{#if webauthnAvailable}
				<SelectionButton selected={selectedEncryption === 'passkey'} onclick={() => selectedEncryption = 'passkey'}>
					<Fingerprint class="w-5 h-5 shrink-0" />
					<div class="flex-1">
						<p class="text-sm font-medium">Passkey</p>
						<p class="text-[11px] {selectedEncryption === 'passkey' ? 'opacity-80' : 'text-muted-foreground'}">Face ID / Touch ID / fingerprint — biometric unlock</p>
					</div>
				</SelectionButton>
			{/if}
		</div>

		{#if selectedEncryption === 'password'}
			<form onsubmit={(e) => { e.preventDefault(); confirmEncryption(); }} class="space-y-2 mb-4" action="https://weby.cash/wallet" method="POST">
				<input type="text" name="username" autocomplete="username" value="webycash-encrypt-password" class="hidden" tabindex="-1" aria-hidden="true" />
				<input
					type="password"
					name="password"
					autocomplete="new-password"
					bind:value={encPassword}
					placeholder="Password (min 8 characters)"
					class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
				/>
				<input
					type="password"
					autocomplete="new-password"
					bind:value={encPasswordConfirm}
					placeholder="Confirm password"
					class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
				/>
			</form>
		{/if}

		{#if encError}
			<div class="mb-4 rounded-2xl bg-danger border border-danger px-4 py-3 text-sm text-danger-foreground dark:text-danger-foreground">
				{encError}
			</div>
		{/if}

		<button onclick={confirmEncryption}
			class="w-full flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all
				{encLoading ? 'opacity-50 animate-pulse' : 'hover:opacity-90'}"
			disabled={encLoading || (selectedEncryption === 'password' && (!encPassword || encPassword.length < 8))}>
			{#if encLoading}
				{selectedEncryption === 'passkey' ? 'Authenticating...' : 'Encrypting...'}
			{:else if selectedEncryption === 'passkey'}
				Encrypt with Passkey
			{:else if selectedEncryption === 'password'}
				Encrypt
			{:else}
				Skip Encryption
			{/if}
		</button>

	{:else if step === 'backup'}
		<h2 class="text-xl font-bold text-foreground mb-2">Back Up Your Secret</h2>
		<Card.Root class="border-danger mb-5">
			<Card.Content class="p-4">
				<p class="text-sm font-medium text-foreground">This is the only way to recover your wallet.</p>
				<p class="text-xs text-muted-foreground mt-1">Write it down or save it somewhere secure. It cannot be recovered later.</p>
			</Card.Content>
		</Card.Root>
		<Card.Root>
			<Card.Content class="p-4">
				<code class="text-xs font-mono break-all select-all text-foreground leading-relaxed block">
					{masterSecret}
				</code>
			</Card.Content>
		</Card.Root>
		<div class="grid grid-cols-2 gap-2 mt-4">
			<Button variant="outline" onclick={copySecret}>
				{#if copied}
					<Check class="w-4 h-4" /> Copied
				{:else}
					<Copy class="w-4 h-4" /> Copy Secret
				{/if}
			</Button>
			<Button variant="outline" onclick={saveToPasswordManager}>
				{#if saved}
					<Check class="w-4 h-4" /> Saved
				{:else}
					<KeyRound class="w-4 h-4" /> Save
				{/if}
			</Button>
		</div>
		<Button class="w-full mt-4" onclick={finish}>
			Open Wallet
		</Button>
	{/if}

	{#if error}
		<div class="mt-4 rounded-2xl bg-danger border border-danger px-4 py-3 text-sm text-danger-foreground dark:text-danger-foreground">
			{error}
		</div>
	{/if}
</div>
