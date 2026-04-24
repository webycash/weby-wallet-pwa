<script lang="ts">
	import { setupWallet, setupFromMnemonic, importWalletSnapshot, importFullBackup,
		scanDeterministicSlots, resetDb, exportWalletSnapshot } from '$lib/stores/wallet.svelte';
	import { markWalletCreated, setEncryptionType, type EncryptionType } from '$lib/stores/settings.svelte';
	import { setNetwork, getNetwork } from '$lib/stores/network.svelte';
	import { isWebAuthnAvailable, encryptWithPasskey, encryptWithPassword } from '$lib/core/encryption';
	import type { WalletSnapshot } from '$lib/core/types';
	import { Plus, KeyRound, Upload, Lock, Fingerprint, ShieldOff, ScanLine, ClipboardPaste, Clipboard } from '@lucide/svelte';
	import Loader from '$lib/components/ui/Loader.svelte';
	import SelectionButton from '$lib/components/ui/selection-button.svelte';

	type Step = 'choose' | 'recover' | 'qrscan' | 'encrypt';

	let { offerClipboardMigration = false, onClipboardMigration = () => {}, migrationImporting = false, migrationError = '' }: {
		offerClipboardMigration?: boolean;
		onClipboardMigration?: () => void;
		migrationImporting?: boolean;
		migrationError?: string;
	} = $props();

	let step = $state<Step>('choose');
	let masterSecret = $state('');
	let recoverInput = $state('');
	let error = $state('');
	let loading = $state(false);
	let selectedEncryption = $state<EncryptionType>('none');
	let encPassword = $state('');
	let encPasswordConfirm = $state('');
	let encLoading = $state(false);
	let encError = $state('');

	const credentialSuffix = (() => {
		const arr = new Uint8Array(4);
		crypto.getRandomValues(arr);
		const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
		return Array.from(arr).map(b => chars[b % chars.length]).join('');
	})();

	const pasteRecover = async () => {
		try {
			const text = await navigator.clipboard.readText();
			if (text.trim()) recoverInput = text.trim();
		} catch {}
	};

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
					// Accept 64-char hex or mnemonic words (at least 12 words)
					const isHex = /^[0-9a-f]{64}$/i.test(value);
					const isMnemonic = value.split(/\s+/).length >= 12;
					if (isHex || isMnemonic) {
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

	let scanProgress = $state('');

	const scanBothNetworks = async () => {
		const original = getNetwork();
		// Scan production
		scanProgress = 'Scanning mainnet...';
		setNetwork('production');
		resetDb();
		await scanDeterministicSlots(10, 20);
		// Scan testnet
		scanProgress = 'Scanning testnet...';
		setNetwork('testnet');
		resetDb();
		await scanDeterministicSlots(10, 20);
		// Restore original network
		setNetwork(original);
		resetDb();
		scanProgress = '';
	};

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

		try {
			await scanBothNetworks();
			step = 'encrypt';
		} catch (e) {
			error = `Scan failed: ${e}`;
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
			const parsed = JSON.parse(text);
			let result;
			// Detect format: FullBackup has master_state + webcash_wallets, WalletSnapshot has master_secret + unspent_outputs
			if (parsed.master_state && parsed.webcash_wallets) {
				result = await importFullBackup(text);
				masterSecret = '';
			} else {
				const snapshot: WalletSnapshot = parsed;
				result = await importWalletSnapshot(snapshot);
				masterSecret = snapshot.master_secret;
			}
			if (result.ok) {
				await scanBothNetworks();
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

			await saveToPasswordManager(`webycash-master-wallet-secret-${credentialSuffix}`);
			finish();
		} catch (e: any) {
			encError = e.message || 'Encryption failed';
		}

		encLoading = false;
	};

	const finish = () => {
		markWalletCreated();
		window.location.reload();
	};

	const saveToPasswordManager = async (credentialId: string) => {
		try {
			if ('PasswordCredential' in window) {
				// @ts-ignore — PasswordCredential constructor
				const cred = new PasswordCredential({
					id: credentialId,
					name: credentialId,
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
				userInput.value = credentialId;

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
		} catch {
			// Best-effort — wallet creation proceeds regardless
		}
	};
</script>

<div class="min-h-[100dvh] flex items-center justify-center px-6 fade-in">
	<div class="w-full max-w-sm">
	{#if loading}
		<div class="flex flex-col items-center justify-center gap-5 py-20">
			<Loader />
			{#if scanProgress}
				<p class="text-[14px] text-muted-foreground">{scanProgress}</p>
			{/if}
		</div>
	{:else if step === 'choose'}
		<div class="space-y-6">
			<div class="text-center">
				{#if offerClipboardMigration}
					<h1 class="text-3xl font-normal text-foreground tracking-tight mb-2">Welcome back</h1>
					<p class="text-[14px] text-muted-foreground leading-relaxed">Import your wallet from Safari, or start a new one.</p>
				{:else}
					<h1 class="text-3xl font-normal text-foreground tracking-tight mb-2">Create Your Wallet</h1>
					<p class="text-[14px] text-muted-foreground leading-relaxed">All data stays on your device. Private by default.</p>
				{/if}
			</div>

			<div class="space-y-2">
				{#if offerClipboardMigration}
					<SelectionButton selected={false} onclick={onClipboardMigration}>
						<Clipboard class="w-5 h-5 shrink-0" />
						<div class="flex-1">
							<p class="text-[15px] font-semibold">{migrationImporting ? 'Importing…' : 'Import from Safari'}</p>
							<p class="text-[11px] text-muted-foreground">Paste the wallet you copied before installing</p>
						</div>
					</SelectionButton>
					{#if migrationError}
						<p class="text-[11px] text-destructive px-2">{migrationError}</p>
					{/if}
				{/if}

				<SelectionButton selected={false} onclick={createNew}>
					<Plus class="w-5 h-5 shrink-0" />
					<div class="flex-1">
						<p class="text-[15px] font-semibold">{loading ? 'Creating...' : 'Create New Wallet'}</p>
						<p class="text-[11px] text-muted-foreground">Generate a fresh master secret</p>
					</div>
				</SelectionButton>

				<SelectionButton selected={false} onclick={() => { step = 'recover' }}>
					<KeyRound class="w-5 h-5 shrink-0" />
					<div class="flex-1">
						<p class="text-[15px] font-semibold">Recover</p>
						<p class="text-[11px] text-muted-foreground">From mnemonic or hex secret</p>
					</div>
				</SelectionButton>

				<label class="w-full flex items-center gap-3 rounded-full bg-muted/50 hover:bg-muted/80 px-5 py-4 text-left transition-all duration-200 cursor-pointer">
					<Upload class="w-5 h-5 shrink-0" />
					<div class="flex-1">
						<p class="text-[15px] font-semibold">Import</p>
						<p class="text-[11px] text-muted-foreground">From JSON backup file</p>
					</div>
					<input type="file" accept=".json" class="hidden" onchange={importFile} />
				</label>

				<SelectionButton selected={false} onclick={() => { step = 'qrscan' }}>
					<ScanLine class="w-5 h-5 shrink-0" />
					<div class="flex-1">
						<p class="text-[15px] font-semibold">Scan QR</p>
						<p class="text-[11px] text-muted-foreground">Import from another device</p>
					</div>
				</SelectionButton>
			</div>

			<a href="https://github.com/webycash/weby-wallet-pwa" target="_blank" rel="noopener noreferrer"
				class="flex items-center justify-center gap-2.5 mt-4 text-[13px] text-primary hover:opacity-70 transition-all duration-200">
				<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
				Open source
			</a>
		</div>

	{:else if step === 'recover'}
		<div class="space-y-6">
			<div class="text-center">
				<h2 class="text-3xl font-normal text-foreground tracking-tight mb-2">Recover Wallet</h2>
				<p class="text-[14px] text-muted-foreground leading-relaxed">Enter your master secret. We'll scan the server for your webcash.</p>
			</div>
			<div class="relative">
				<textarea
					bind:value={recoverInput}
					placeholder="24 words or 64-char hex..."
					class="w-full rounded-2xl bg-muted/50 px-4 py-3 pr-20 text-[14px] font-mono h-24 resize-none focus:outline-none focus:ring-2 focus:ring-primary transition-all"
					autocomplete="off"
					spellcheck="false"
				></textarea>
				<button onclick={pasteRecover}
					class="absolute top-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-all">
					<ClipboardPaste class="w-3 h-3" /> Paste
				</button>
			</div>
			<div class="flex gap-3">
				<button onclick={() => { step = 'choose'; error = '' }}
					class="flex-1 rounded-full bg-muted/50 px-4 py-3.5 text-[15px] font-semibold hover:bg-muted/80 transition-all duration-200 active:scale-[0.97]">
					Back
				</button>
				<button onclick={recoverFromSecret}
					class="flex-1 rounded-full bg-primary px-4 py-3.5 text-[15px] font-semibold text-primary-foreground transition-all duration-200 active:scale-[0.97] disabled:opacity-30"
					disabled={loading || (recoverInput.trim().length < 10)}>
					{loading ? (scanProgress || 'Scanning...') : 'Recover'}
				</button>
			</div>
		</div>

	{:else if step === 'qrscan'}
		<div class="space-y-5">
			<div class="text-center">
				<h2 class="text-3xl font-normal text-foreground tracking-tight mb-2">Scan QR Code</h2>
				<p class="text-[14px] text-muted-foreground leading-relaxed">
					Open your wallet on the other device, go to Settings > QR Export, and scan the code.
				</p>
			</div>
			<div class="rounded-3xl overflow-hidden bg-black aspect-square relative max-w-[280px] mx-auto">
				<video bind:this={videoEl} autoplay playsinline muted class="w-full h-full object-cover"></video>
				<canvas bind:this={canvasEl} class="hidden"></canvas>
				<div class="absolute inset-0 pointer-events-none">
					<div class="absolute inset-[12%] border-2 border-primary/40 rounded-2xl"></div>
				</div>
				<div class="absolute bottom-3 left-0 right-0 text-center">
					<span class="text-[11px] text-white/80 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">{scanStatus}</span>
				</div>
			</div>
			<p class="text-[11px] text-muted-foreground/60 text-center">
				Or paste the master secret manually:
			</p>
			<div class="relative">
				<textarea
					bind:value={recoverInput}
					placeholder="24 words or 64-char hex..."
					class="w-full rounded-2xl bg-muted/50 px-4 py-3 pr-20 text-[14px] font-mono h-16 resize-none focus:outline-none focus:ring-2 focus:ring-primary transition-all"
					autocomplete="off"
					spellcheck="false"
				></textarea>
				<button onclick={pasteRecover}
					class="absolute top-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-all">
					<ClipboardPaste class="w-3 h-3" /> Paste
				</button>
			</div>
			<div class="flex gap-3">
				<button onclick={() => { stopCamera(); step = 'choose'; error = '' }}
					class="flex-1 rounded-full bg-muted/50 px-4 py-3.5 text-[15px] font-semibold hover:bg-muted/80 transition-all duration-200 active:scale-[0.97]">
					Back
				</button>
				<button onclick={recoverFromSecret}
					class="flex-1 rounded-full bg-primary px-4 py-3.5 text-[15px] font-semibold text-primary-foreground transition-all duration-200 active:scale-[0.97] disabled:opacity-30"
					disabled={loading || (recoverInput.trim().length < 10)}>
					{loading ? (scanProgress || 'Importing...') : 'Import'}
				</button>
			</div>
		</div>

	{:else if step === 'encrypt'}
		<div class="space-y-6">
			<div class="text-center">
				<h2 class="text-3xl font-normal text-foreground tracking-tight mb-2">Protect Your Wallet</h2>
				<p class="text-[14px] text-muted-foreground leading-relaxed">Choose how to encrypt your wallet data.</p>
			</div>

			<div class="space-y-2">
				<SelectionButton selected={selectedEncryption === 'none'} onclick={() => selectedEncryption = 'none'}>
					<ShieldOff class="w-5 h-5 shrink-0" />
					<div class="flex-1">
						<p class="text-[15px] font-semibold">No encryption</p>
						<p class="text-[11px] {selectedEncryption === 'none' ? 'opacity-70' : 'text-muted-foreground'}">Wallet data stored unencrypted</p>
					</div>
				</SelectionButton>

				<SelectionButton selected={selectedEncryption === 'password'} onclick={() => selectedEncryption = 'password'}>
					<Lock class="w-5 h-5 shrink-0" />
					<div class="flex-1">
						<p class="text-[15px] font-semibold">Password</p>
						<p class="text-[11px] {selectedEncryption === 'password' ? 'opacity-70' : 'text-muted-foreground'}">Argon2 + AES-256-GCM encryption</p>
					</div>
				</SelectionButton>

				{#if webauthnAvailable}
					<SelectionButton selected={selectedEncryption === 'passkey'} onclick={() => selectedEncryption = 'passkey'}>
						<Fingerprint class="w-5 h-5 shrink-0" />
						<div class="flex-1">
							<p class="text-[15px] font-semibold">Passkey</p>
							<p class="text-[11px] {selectedEncryption === 'passkey' ? 'opacity-70' : 'text-muted-foreground'}">Face ID / Touch ID / fingerprint</p>
						</div>
					</SelectionButton>
				{/if}
			</div>

			{#if selectedEncryption === 'password'}
				<form onsubmit={(e) => { e.preventDefault(); confirmEncryption(); }} class="space-y-2" action="https://weby.cash/wallet" method="POST">
					<input type="text" name="username" autocomplete="username" value={`webycash-encrypt-password-${credentialSuffix}`} class="hidden" tabindex="-1" aria-hidden="true" />
					<input
						type="password"
						name="password"
						autocomplete="new-password"
						bind:value={encPassword}
						placeholder="Password (min 8 characters)"
						class="w-full rounded-full bg-muted/50 px-4 py-3.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary transition-all"
					/>
					<input
						type="password"
						autocomplete="new-password"
						bind:value={encPasswordConfirm}
						placeholder="Confirm password"
						class="w-full rounded-full bg-muted/50 px-4 py-3.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary transition-all"
					/>
				</form>
			{/if}

			{#if encError}
				<div class="rounded-2xl bg-muted/50 px-4 py-3 text-[13px] text-foreground">
					{encError}
				</div>
			{/if}

			<button onclick={confirmEncryption}
				class="w-full rounded-full bg-primary px-4 py-3.5 text-[15px] font-semibold text-primary-foreground transition-all duration-200 active:scale-[0.97]
					{encLoading ? 'opacity-40' : 'hover:opacity-90'}"
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

			<button onclick={() => { step = 'choose'; encError = ''; }}
				class="w-full text-[14px] text-muted-foreground hover:text-foreground transition-all">
				Back
			</button>
		</div>
	{/if}

	{#if error}
		<div class="mt-6 rounded-2xl bg-muted/50 px-4 py-3 text-[13px] text-foreground">
			{error}
		</div>
	{/if}
	</div>
</div>
