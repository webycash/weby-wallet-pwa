<script lang="ts">
	import LicenseDialog from '$lib/components/wallet/LicenseDialog.svelte';
	import SetupWizard from '$lib/components/wallet/SetupWizard.svelte';
	import Dashboard from '$lib/components/wallet/Dashboard.svelte';
	import LockScreen from '$lib/components/wallet/LockScreen.svelte';
	import { licenseAccepted, walletExists, encryptionType } from '$lib/stores/settings.svelte';

	let unlocked = $state(encryptionType() === 'none');
</script>

<svelte:head>
	<title>Weby Wallet</title>
	<meta name="description" content="Private webcash wallet — runs entirely in your browser" />
</svelte:head>

{#if !licenseAccepted()}
	<LicenseDialog />
{:else if !walletExists()}
	<SetupWizard />
{:else if !unlocked}
	<LockScreen onUnlock={() => { unlocked = true; }} />
{:else}
	<Dashboard />
{/if}
