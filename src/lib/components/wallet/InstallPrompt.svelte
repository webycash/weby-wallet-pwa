<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { Share, Plus, Clipboard, ClipboardCheck, Loader } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import { exportMigrationBundle } from '$lib/core/migration';
	import { walletExists } from '$lib/stores/settings.svelte';

	const INSTALLED_KEY = 'weby_install_done';

	let { autoShow = false }: { autoShow?: boolean } = $props();

	let open = $state(false);
	let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let installing = $state(false);
	let installed = $state(false);
	let preparing = $state(false);
	let prepared = $state(false);
	let prepareError = $state('');

	const isIOS = browser && /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
	const isStandalone = browser && (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as any).standalone === true
	);
	const hasWallet = $derived(browser && walletExists());

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	export const show = () => { if (!isStandalone) open = true; };

	onMount(() => {
		if (!browser || isStandalone) return;

		if ((window as any).__installPrompt) {
			deferredPrompt = (window as any).__installPrompt;
		}

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

	const prepareMigration = async () => {
		preparing = true;
		prepareError = '';
		try {
			const bundle = await exportMigrationBundle();
			await navigator.clipboard.writeText(bundle);
			prepared = true;
		} catch (e: any) {
			prepareError = e?.message || 'Could not access clipboard — try again';
		}
		preparing = false;
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
					{#if hasWallet && !prepared}
						<div class="mb-4 rounded-xl bg-warning/10 p-3 text-[11px] leading-relaxed text-foreground">
							<p class="font-semibold mb-1">One-tap migration</p>
							<p class="text-muted-foreground">iOS gives the installed app a separate storage area. Tap below to copy your wallet so the app auto-imports it on first launch.</p>
						</div>
						<button onclick={prepareMigration} disabled={preparing}
							class="w-full flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50 mb-4">
							{#if preparing}
								<Loader class="w-4 h-4 animate-spin" /> Preparing…
							{:else}
								<Clipboard class="w-4 h-4" /> Copy wallet for install
							{/if}
						</button>
						{#if prepareError}
							<p class="text-[11px] text-destructive mb-3">{prepareError}</p>
						{/if}
					{/if}

					{#if prepared}
						<div class="mb-4 rounded-xl bg-success/10 p-3 text-[11px] leading-relaxed text-foreground flex items-start gap-2">
							<ClipboardCheck class="w-4 h-4 text-success shrink-0 mt-0.5" />
							<div>
								<p class="font-semibold text-success mb-0.5">Wallet copied</p>
								<p class="text-muted-foreground">Now add the app to your Home Screen — it will auto-import on first launch.</p>
							</div>
						</div>
					{/if}

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
						class="w-full rounded-full bg-muted hover:bg-muted/80 px-4 py-2.5 text-sm font-semibold text-foreground transition-all">
						Done
					</button>
				{:else}
					<div class="flex justify-center">
						<Button variant="outline" size="sm" onclick={install} disabled={installing}>
							{installing ? 'Installing…' : 'Install'}
						</Button>
					</div>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
