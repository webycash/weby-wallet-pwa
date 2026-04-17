<script lang="ts">
	import { setupWallet, importWalletSnapshot, recoverWallet } from '$lib/stores/wallet.svelte';
	import { markWalletCreated, setEncryptionType, type EncryptionType } from '$lib/stores/settings.svelte';
	import { getNetwork } from '$lib/stores/network.svelte';
	import { isWebAuthnAvailable, encryptWithPasskey, encryptWithPassword } from '$lib/core/encryption';
	import type { WalletSnapshot } from '$lib/core/types';
	import { exportWalletSnapshot } from '$lib/stores/wallet.svelte';
	import { Plus, KeyRound, Upload, Lock, Fingerprint, ShieldOff, Copy, Check, ScanLine } from '@lucide/svelte';

	type Step = 'choose' | 'recover' | 'qrscan' | 'encrypt' | 'backup';

	let step = $state<Step>('choose');
	let masterSecret = $state('');
	let recoverInput = $state('');
	let error = $state('');
	let loading = $state(false);
	let copied = $state(false);
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
				// Auto-recover to find any webcash on the server
				await recoverWallet(getNetwork(), snapshot.master_secret, 20);
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
				<div class="rounded-full bg-primary/10 p-2.5">
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

			<button onclick={() => { step = 'qrscan' }}
				class="w-full flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left hover:border-primary/30 hover:bg-primary/5 transition-all">
				<div class="rounded-xl bg-pink-500/10 p-2.5">
					<ScanLine class="w-5 h-5 text-pink-500" />
				</div>
				<div>
					<span class="font-semibold text-foreground text-sm">Scan QR Code</span>
					<span class="block text-xs text-muted-foreground mt-0.5">Import wallet from another device via camera</span>
				</div>
			</button>
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
				class="flex-1 rounded-full border border-border px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-all">
				Back
			</button>
			<button onclick={recoverFromSecret}
				class="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40"
				disabled={loading || recoverInput.trim().length !== 64}>
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
				<div class="absolute inset-[12%] border-2 border-primary/60 rounded-2xl"></div>
				<div class="absolute inset-[12%] border-2 border-primary/20 rounded-2xl animate-pulse"></div>
			</div>
			<div class="absolute bottom-3 left-0 right-0 text-center">
				<span class="text-xs text-white/80 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">{scanStatus}</span>
			</div>
		</div>
		<p class="text-xs text-muted-foreground text-center mb-3">
			Or paste the master secret manually:
		</p>
		<textarea
			bind:value={recoverInput}
			placeholder="64-character hex master secret..."
			class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-mono h-16 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
			autocomplete="off"
			spellcheck="false"
		></textarea>
		<div class="flex gap-2 mt-4">
			<button onclick={() => { stopCamera(); step = 'choose'; error = '' }}
				class="flex-1 rounded-full border border-border px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-all">
				Back
			</button>
			<button onclick={recoverFromSecret}
				class="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40"
				disabled={loading || recoverInput.trim().length !== 64}>
				{loading ? 'Importing...' : 'Import'}
			</button>
		</div>

	{:else if step === 'encrypt'}
		<h2 class="text-xl font-bold text-foreground mb-2">Protect Your Wallet</h2>
		<p class="text-sm text-muted-foreground mb-5">Choose how to encrypt your wallet data.</p>

		<div class="space-y-2 mb-5">
			<button onclick={() => selectedEncryption = 'none'}
				class="w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-all
					{selectedEncryption === 'none' ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-border'}">
				<ShieldOff class="w-5 h-5 {selectedEncryption === 'none' ? 'text-primary' : 'text-muted-foreground'}" />
				<div class="flex-1">
					<p class="text-sm font-medium">No encryption</p>
					<p class="text-[11px] text-muted-foreground">Quick access, less secure</p>
				</div>
				{#if selectedEncryption === 'none'}<div class="w-2 h-2 rounded-full bg-primary"></div>{/if}
			</button>

			<button onclick={() => selectedEncryption = 'password'}
				class="w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-all
					{selectedEncryption === 'password' ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-border'}">
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
						{selectedEncryption === 'passkey' ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-border'}">
					<Fingerprint class="w-5 h-5 {selectedEncryption === 'passkey' ? 'text-primary' : 'text-muted-foreground'}" />
					<div class="flex-1">
						<p class="text-sm font-medium">Passkey</p>
						<p class="text-[11px] text-muted-foreground">Face ID / Touch ID / fingerprint — biometric unlock</p>
					</div>
					{#if selectedEncryption === 'passkey'}<div class="w-2 h-2 rounded-full bg-primary"></div>{/if}
				</button>
			{/if}
		</div>

		{#if selectedEncryption === 'password'}
			<div class="space-y-2 mb-4">
				<input
					type="password"
					bind:value={encPassword}
					placeholder="Password (min 8 characters)"
					class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
				/>
				<input
					type="password"
					bind:value={encPasswordConfirm}
					placeholder="Confirm password"
					class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
				/>
			</div>
		{/if}

		{#if encError}
			<div class="mb-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
				{encError}
			</div>
		{/if}

		<button onclick={confirmEncryption}
			class="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40"
			disabled={encLoading || (selectedEncryption === 'password' && (!encPassword || encPassword.length < 8))}>
			{#if encLoading}
				{selectedEncryption === 'passkey' ? 'Authenticate with biometrics...' : 'Encrypting...'}
			{:else if selectedEncryption === 'passkey'}
				Authenticate & Encrypt
			{:else if selectedEncryption === 'password'}
				Encrypt Wallet
			{:else}
				Continue Without Encryption
			{/if}
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
				class="absolute top-3 right-3 rounded-lg p-2 bg-card border border-border hover:border-border transition-all">
				{#if copied}
					<Check class="w-3.5 h-3.5 text-emerald-500" />
				{:else}
					<Copy class="w-3.5 h-3.5 text-muted-foreground" />
				{/if}
			</button>
		</div>
		<button onclick={finish}
			class="w-full mt-5 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
			I've Saved It — Open Wallet
		</button>
	{/if}

	{#if error}
		<div class="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
			{error}
		</div>
	{/if}
</div>
