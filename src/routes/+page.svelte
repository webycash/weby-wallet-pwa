<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import LicenseDialog from '$lib/components/wallet/LicenseDialog.svelte';
	import SetupWizard from '$lib/components/wallet/SetupWizard.svelte';
	import Dashboard from '$lib/components/wallet/Dashboard.svelte';
	import LockScreen from '$lib/components/wallet/LockScreen.svelte';
	import ReceiveGift from '$lib/components/wallet/ReceiveGift.svelte';
	import { licenseAccepted, walletExists, encryptionType, acceptLicense, markWalletCreated } from '$lib/stores/settings.svelte';
	import { setNetwork } from '$lib/stores/network.svelte';
	import { setupWallet, insertWebcash, resetDb } from '$lib/stores/wallet.svelte';
	import type { NetworkMode } from '$lib/core/types';

	let unlocked = $state(encryptionType() === 'none');
	let pendingWebcash = $state('');
	let pendingNetwork = $state<NetworkMode>('production');
	let pendingAmount = $state('');
	let receiving = $state(false);
	let receiveError = $state('');
	let receiveSuccess = $state(false);

	onMount(() => {
		if (!browser) return;
		const params = new URLSearchParams(window.location.search);
		const wc = params.get('webcash');
		const net = params.get('network') as NetworkMode | null;
		const amt = params.get('amount');

		if (wc) {
			pendingWebcash = wc;
			pendingNetwork = net === 'testnet' ? 'testnet' : 'production';
			pendingAmount = amt || '';
			window.history.replaceState({}, '', window.location.pathname);

			// If user has no wallet, fast-track: accept license + create wallet + insert
			if (!licenseAccepted() || !walletExists()) {
				receiving = true;
				fastTrackReceive(wc, pendingNetwork);
			}
		}
	});

	const fastTrackReceive = async (wc: string, net: NetworkMode) => {
		try {
			acceptLicense();
			setNetwork(net);
			resetDb();
			const result = await setupWallet();
			if (!result.ok) { receiveError = result.error; return; }
			markWalletCreated();

			const insertResult = await insertWebcash(net, wc);
			if (insertResult.ok) {
				receiveSuccess = true;
			} else {
				receiveError = insertResult.error;
			}
		} catch (e: any) {
			receiveError = e.message || 'Failed to receive';
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
		network={pendingNetwork}
		success={receiveSuccess}
		error={receiveError}
		onContinue={continueToWallet}
	/>
{:else if !licenseAccepted()}
	<LicenseDialog />
{:else if !walletExists()}
	<SetupWizard />
{:else if !unlocked}
	<LockScreen onUnlock={() => { unlocked = true; }} />
{:else}
	<Dashboard {pendingWebcash} />
{/if}
