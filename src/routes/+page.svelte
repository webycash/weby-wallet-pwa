<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import LicenseDialog from '$lib/components/wallet/LicenseDialog.svelte';
	import SetupWizard from '$lib/components/wallet/SetupWizard.svelte';
	import Dashboard from '$lib/components/wallet/Dashboard.svelte';
	import LockScreen from '$lib/components/wallet/LockScreen.svelte';
	import ReceiveGift from '$lib/components/wallet/ReceiveGift.svelte';
	import InstallPrompt from '$lib/components/wallet/InstallPrompt.svelte';
	import { licenseAccepted, walletExists, encryptionType, acceptLicense, markWalletCreated } from '$lib/stores/settings.svelte';
	import { setNetwork } from '$lib/stores/network.svelte';
	import { setupWallet, insertWebcash, resetDb } from '$lib/stores/wallet.svelte';
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

	const dismissLoader = () => {
		requestAnimationFrame(() => {
			const root = document.getElementById('app-root');
			if (root) root.style.opacity = '1';
			const el = document.getElementById('app-loader');
			if (el) el.remove();
		});
	};

	onMount(() => {
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

		if (wc) {
			pendingWebcash = wc;
			pendingNetwork = net === 'testnet' ? 'testnet' : 'production';
			pendingAmount = amt || '';
			pendingMemo = memo || '';
			// Don't clean URL yet — keep params until license accepted
		}
	});

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
{:else if !licenseAccepted()}
	<LicenseDialog onAccepted={onLicenseAccepted} hasGift={!!pendingWebcash} giftAmount={pendingAmount} giftMemo={pendingMemo} />
{:else if !walletExists()}
	<SetupWizard />
{:else if !unlocked}
	<LockScreen onUnlock={() => { unlocked = true; }} />
{:else}
	<Dashboard {pendingWebcash} onLock={() => { unlocked = false; }} onInstall={() => installPrompt?.show()} />
	<InstallPrompt bind:this={installPrompt} />
{/if}
