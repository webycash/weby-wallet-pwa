<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Download, Share, Plus, X } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Button from '$lib/components/ui/button/button.svelte';

	const DISMISSED_KEY = 'weby_install_dismissed';
	const INSTALLED_KEY = 'weby_install_done';

	let open = $state(false);
	let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let installing = $state(false);
	let installed = $state(false);

	// Platform detection
	const isIOS = browser && /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
	const isAndroid = browser && /Android/.test(navigator.userAgent);
	const isStandalone = browser && (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as any).standalone === true
	);

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	onMount(() => {
		if (!browser || isStandalone) return;
		if (localStorage.getItem(INSTALLED_KEY) === 'true') return;

		// Android: capture the native install prompt
		const handler = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e as BeforeInstallPromptEvent;
			maybeShow();
		};
		window.addEventListener('beforeinstallprompt', handler);

		// Track successful install
		window.addEventListener('appinstalled', () => {
			installed = true;
			deferredPrompt = null;
			localStorage.setItem(INSTALLED_KEY, 'true');
			setTimeout(() => { open = false; }, 1500);
		});

		// iOS: show after a short delay if not dismissed recently
		if (isIOS) {
			setTimeout(maybeShow, 2000);
		}

		return () => window.removeEventListener('beforeinstallprompt', handler);
	});

	const maybeShow = () => {
		if (isStandalone) return;
		if (localStorage.getItem(INSTALLED_KEY) === 'true') return;
		const dismissed = localStorage.getItem(DISMISSED_KEY);
		if (dismissed) {
			const elapsed = Date.now() - parseInt(dismissed, 10);
			if (elapsed < 7 * 24 * 60 * 60 * 1000) return; // 7 day cooldown
		}
		open = true;
	};

	const installAndroid = async () => {
		if (!deferredPrompt) return;
		installing = true;
		await deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		if (outcome === 'accepted') {
			installed = true;
			localStorage.setItem(INSTALLED_KEY, 'true');
		}
		deferredPrompt = null;
		installing = false;
	};

	const dismiss = () => {
		open = false;
		localStorage.setItem(DISMISSED_KEY, Date.now().toString());
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm rounded-2xl border-border/50 p-0 overflow-hidden">
		<!-- Header with gradient -->
		<div class="bg-gradient-to-b from-primary/10 to-transparent px-6 pt-8 pb-4 text-center">
			<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
				<img src="{import.meta.env.BASE_URL || '/'}logo.svg" alt="Weby" class="h-9 w-9" />
			</div>

			{#if installed}
				<h2 class="text-xl font-bold text-foreground">Installed</h2>
				<p class="text-sm text-muted-foreground mt-1">Weby Wallet is on your home screen</p>
			{:else}
				<h2 class="text-xl font-bold text-foreground">Install Weby Wallet</h2>
				<p class="text-sm text-muted-foreground mt-1">
					{#if isIOS}
						Add to your home screen for full offline access
					{:else}
						Install for instant launch and offline access
					{/if}
				</p>
			{/if}
		</div>

		<div class="px-6 pb-6">
			{#if installed}
				<!-- Success state -->
				<div class="flex items-center justify-center py-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
						<svg class="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
					</div>
				</div>
			{:else if isIOS}
				<!-- iOS instructions -->
				<div class="space-y-3 mb-5">
					<div class="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<span class="text-sm font-bold">1</span>
						</div>
						<p class="text-sm text-foreground">
							Tap the <Share class="inline-block h-4 w-4 text-primary -mt-0.5" /> share button in Safari
						</p>
					</div>
					<div class="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<span class="text-sm font-bold">2</span>
						</div>
						<p class="text-sm text-foreground">
							Scroll down and tap <Plus class="inline-block h-4 w-4 text-primary -mt-0.5" /> <strong>Add to Home Screen</strong>
						</p>
					</div>
					<div class="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<span class="text-sm font-bold">3</span>
						</div>
						<p class="text-sm text-foreground">
							Tap <strong>Add</strong> to install
						</p>
					</div>
				</div>

				<button
					onclick={dismiss}
					class="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90"
				>
					Got it
				</button>
			{:else}
				<!-- Android / desktop install -->
				<div class="space-y-3 mb-5">
					<div class="flex items-start gap-3">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary mt-0.5">
							<Download class="h-4 w-4" />
						</div>
						<div>
							<p class="text-sm font-medium text-foreground">Works offline</p>
							<p class="text-xs text-muted-foreground">View balance and export wallets without internet</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary mt-0.5">
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
							</svg>
						</div>
						<div>
							<p class="text-sm font-medium text-foreground">Instant launch</p>
							<p class="text-xs text-muted-foreground">Opens from your home screen like a native app</p>
						</div>
					</div>
				</div>

				{#if deferredPrompt}
					<button
						onclick={installAndroid}
						disabled={installing}
						class="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all
							{installing ? 'opacity-60 animate-pulse' : 'hover:opacity-90'}"
					>
						{installing ? 'Installing…' : 'Install App'}
					</button>
				{:else}
					<p class="text-xs text-center text-muted-foreground py-2">
						Use your browser menu → "Install app" or "Add to Home screen"
					</p>
				{/if}
			{/if}

			{#if !installed}
				<button
					onclick={dismiss}
					class="w-full mt-2 rounded-full px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					Not now
				</button>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
