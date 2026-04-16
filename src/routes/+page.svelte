<script lang="ts">
	import LicenseDialog from '$lib/components/wallet/LicenseDialog.svelte';
	import SetupWizard from '$lib/components/wallet/SetupWizard.svelte';
	import Dashboard from '$lib/components/wallet/Dashboard.svelte';
	import { licenseAccepted, walletExists } from '$lib/stores/settings.svelte';
</script>

<svelte:head>
	<title>Weby Wallet</title>
	<meta name="description" content="Private webcash wallet — runs entirely in your browser" />
</svelte:head>

{#if !licenseAccepted()}
	<LicenseDialog />
{:else if !walletExists()}
	<SetupWizard />
{:else}
	<Dashboard />
{/if}
