<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import LicenseDialog from '$lib/components/wallet/LicenseDialog.svelte';
	import SetupWizard from '$lib/components/wallet/SetupWizard.svelte';
	import AppShell from '$lib/components/wallet/AppShell.svelte';
	import LockScreen from '$lib/components/wallet/LockScreen.svelte';
	import ReceiveGift from '$lib/components/wallet/ReceiveGift.svelte';
	import InstallPrompt from '$lib/components/wallet/InstallPrompt.svelte';
	import Loader from '$lib/components/ui/Loader.svelte';
	import { licenseAccepted, walletExists, encryptionType, acceptLicense, markWalletCreated } from '$lib/stores/settings.svelte';
	import { setNetwork } from '$lib/stores/network.svelte';
	import { setupWallet, insertWebcash, resetDb } from '$lib/stores/wallet.svelte';
	import { parseMigrationBundle, importMigrationBundle, readClipboardBundle, clearClipboard, type MigrationBundle } from '$lib/core/migration';
	import type { NetworkMode } from '$lib/core/types';

	let unlocked = $state(encryptionType() === 'none');
	let installPrompt = $state<ReturnType<typeof InstallPrompt>>();
	let pendingWebcash = $state('');
	let pendingNetwork = $state<NetworkMode>('production');
	let pendingAmount = $state('');
	let pendingMemo = $state('');
	let receiving = $state(false);
	let receiveError = $state('');
	let receiveSuccess = $state(false);
	let migrationOffer = $state<MigrationBundle | null>(null);
	let migrationImporting = $state(false);
	let migrationError = $state('');

	const isIOS = browser && /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
	const isStandalone = browser && (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as any).standalone === true
	);

	const dismissLoader = async () => {
		await document.fonts.ready;
		requestAnimationFrame(() => {
			const el = document.getElementById('app-loader');
			if (el) el.remove();
			const root = document.getElementById('app-root');
			if (root) root.style.opacity = '1';
		});
	};

	onMount(async () => {
		if (!browser) return;
		// Dismiss loader for non-Dashboard screens (license, setup, lock)
		if (!walletExists() || !licenseAccepted() || encryptionType() !== 'none') {
			dismissLoader();
		}
		const params = new URLSearchParams(window.location.search);
		const wc = params.get('webcash');
		const net = params.get('network') as NetworkMode | null;
		const amt = params.get('amount');
		const memo = params.get('memo');
		const migrate = params.get('migrate');

		if (wc) {
			pendingWebcash = wc;
			pendingNetwork = net === 'testnet' ? 'testnet' : 'production';
			pendingAmount = amt || '';
			pendingMemo = memo || '';
			// Don't clean URL yet — keep params until license accepted
		}

		// Migration via URL param (passed from Safari link / share sheet)
		if (migrate && !walletExists()) {
			const bundle = parseMigrationBundle(migrate);
			if (bundle) {
				migrationOffer = bundle;
				// Strip the param so it doesn't persist on reloads
				params.delete('migrate');
				const next = params.toString();
				window.history.replaceState({}, '', window.location.pathname + (next ? '?' + next : ''));
				return;
			}
		}

		// Fresh iOS standalone install → try the clipboard once (user gesture
		// comes later, so we just prime; the Setup screen will also offer this)
		if (isIOS && isStandalone && !walletExists()) {
			// Nothing to do at mount — clipboard reads require a gesture.
		}
	});

	const applyMigration = async (bundle: MigrationBundle) => {
		migrationImporting = true;
		migrationError = '';
		try {
			await importMigrationBundle(bundle);
			await clearClipboard();
			window.location.reload();
		} catch (e: any) {
			migrationError = e?.message || 'Import failed';
			migrationImporting = false;
		}
	};

	const tryClipboardMigration = async () => {
		migrationImporting = true;
		migrationError = '';
		const bundle = await readClipboardBundle();
		if (!bundle) {
			migrationError = 'No wallet found on clipboard — copy it again from Safari and try once more.';
			migrationImporting = false;
			return;
		}
		await applyMigration(bundle);
	};

	const dismissMigrationOffer = () => {
		migrationOffer = null;
	};

	const onLicenseAccepted = async () => {
		if (pendingWebcash) {
			// After license: auto-create wallet + insert
			receiving = true;
			window.history.replaceState({}, '', window.location.pathname);
			try {
				setNetwork(pendingNetwork);
				resetDb();
				const result = await setupWallet();
				if (!result.ok) { receiveError = result.error; return; }
				markWalletCreated();

				const insertResult = await insertWebcash(pendingWebcash);
				if (insertResult.ok) {
					receiveSuccess = true;
				} else {
					receiveError = insertResult.error;
				}
			} catch (e: any) {
				receiveError = e.message || 'Failed to receive';
			}
		} else {
			window.location.reload();
		}
	};

	const continueToWallet = () => {
		receiving = false;
		window.location.reload();
	};
</script>

<svelte:head>
	<title>Weby Wallet</title>
	<meta name="description" content="Private webcash wallet — runs entirely in your browser" />
</svelte:head>

{#if receiving}
	<ReceiveGift
		amount={pendingAmount}
		memo={pendingMemo}
		network={pendingNetwork}
		success={receiveSuccess}
		error={receiveError}
		onContinue={continueToWallet}
	/>
{:else if migrationOffer}
	<div class="min-h-[100dvh] flex items-center justify-center px-6">
		<div class="w-full max-w-sm space-y-6 text-center">
			<h1 class="text-3xl font-normal tracking-tight">Import your wallet</h1>
			<p class="text-[14px] text-muted-foreground leading-relaxed">
				A wallet from Safari is ready to import. This brings over your mnemonic, wallets, and encryption settings.
			</p>
			{#if migrationError}
				<div class="rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] text-destructive">{migrationError}</div>
			{/if}
			<button onclick={() => applyMigration(migrationOffer!)} disabled={migrationImporting}
				class="w-full rounded-full bg-primary px-4 py-3.5 text-[15px] font-semibold text-primary-foreground transition-all duration-200 active:scale-[0.97] hover:opacity-90 disabled:opacity-50">
				{#if migrationImporting}
					<Loader />
				{:else}
					Import wallet
				{/if}
			</button>
			<button onclick={dismissMigrationOffer}
				class="w-full text-[13px] text-muted-foreground hover:text-foreground transition-all">
				Start fresh instead
			</button>
		</div>
	</div>
{:else if !licenseAccepted()}
	<LicenseDialog onAccepted={onLicenseAccepted} hasGift={!!pendingWebcash} giftAmount={pendingAmount} giftMemo={pendingMemo} />
{:else if !walletExists()}
	<SetupWizard offerClipboardMigration={isIOS && isStandalone} onClipboardMigration={tryClipboardMigration} {migrationImporting} {migrationError} />
{:else if !unlocked}
	<LockScreen onUnlock={() => { unlocked = true; }} />
{:else}
	<AppShell {pendingWebcash} onLock={() => { unlocked = false; }} onInstall={() => installPrompt?.show()} />
	<InstallPrompt bind:this={installPrompt} />
{/if}
