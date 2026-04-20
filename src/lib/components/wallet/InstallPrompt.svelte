<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { Share, Plus } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	const INSTALLED_KEY = 'weby_install_done';

	let { autoShow = false }: { autoShow?: boolean } = $props();

	let open = $state(false);
	let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let installing = $state(false);
	let installed = $state(false);

	const isIOS = browser && /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
	const isStandalone = browser && (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as any).standalone === true
	);

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	export const show = () => { if (!isStandalone) open = true; };

	onMount(() => {
		if (!browser || isStandalone) return;

		// Pick up globally captured event (fires before Svelte mounts)
		if ((window as any).__installPrompt) {
			deferredPrompt = (window as any).__installPrompt;
		}

		// Also listen for late fires
		const handler = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e as BeforeInstallPromptEvent;
			(window as any).__installPrompt = e;
		};
		window.addEventListener('beforeinstallprompt', handler);

		window.addEventListener('appinstalled', () => {
			installed = true;
			deferredPrompt = null;
			(window as any).__installPrompt = null;
			localStorage.setItem(INSTALLED_KEY, 'true');
			setTimeout(() => { open = false; }, 1500);
		});

		// Auto-show on first visit (before license) if not already installed
		if (autoShow && localStorage.getItem(INSTALLED_KEY) !== 'true') {
			setTimeout(() => { open = true; }, 800);
		}

		return () => window.removeEventListener('beforeinstallprompt', handler);
	});

	const install = async () => {
		if (!deferredPrompt) return;
		installing = true;
		await deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		if (outcome === 'accepted') {
			installed = true;
			localStorage.setItem(INSTALLED_KEY, 'true');
		}
		deferredPrompt = null;
		(window as any).__installPrompt = null;
		installing = false;
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-xs rounded-2xl border-border bg-card p-0 overflow-hidden gap-0">
		<div class="px-6 pt-7 pb-5 text-center">
			<img
				src="{base}/logo.svg"
				alt="Weby Wallet"
				class="mx-auto mb-5 h-14 dark:brightness-0 dark:invert"
			/>

			{#if installed}
				<div class="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-success/15">
					<svg class="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
					</svg>
				</div>
				<p class="text-sm font-semibold text-foreground">Installed</p>
				<p class="text-xs text-muted-foreground mt-1">Find Weby Wallet on your home screen</p>
			{:else}
				<p class="text-sm font-semibold text-foreground">Install Weby Wallet</p>
				<p class="text-xs text-muted-foreground mt-1">
					{isIOS ? 'Add to your home screen for offline access' : 'Launch instantly and work offline'}
				</p>
			{/if}
		</div>

		{#if !installed}
			<div class="border-t border-border px-6 py-5">
				{#if isIOS}
					<ol class="space-y-3 mb-5">
						<li class="flex items-center gap-3">
							<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">1</span>
							<span class="text-sm text-foreground">Tap <Share class="inline-block h-3.5 w-3.5 text-primary align-text-top" /> in Safari</span>
						</li>
						<li class="flex items-center gap-3">
							<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">2</span>
							<span class="text-sm text-foreground">Tap <Plus class="inline-block h-3.5 w-3.5 text-primary align-text-top" /> <strong>Add to Home Screen</strong></span>
						</li>
						<li class="flex items-center gap-3">
							<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">3</span>
							<span class="text-sm text-foreground">Tap <strong>Add</strong></span>
						</li>
					</ol>
					<button onclick={() => open = false}
						class="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90">
						Got it
					</button>
				{:else}
					<button onclick={install} disabled={installing}
						class="mx-auto flex rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground transition-all
							{installing ? 'opacity-60 animate-pulse' : 'hover:border-primary hover:text-primary'}">
						{installing ? 'Installing\u2026' : 'Install'}
					</button>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
