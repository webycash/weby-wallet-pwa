<script lang="ts">
	// RGB asset-tab shell. Views: assets (honest empty list — no enumeration cmd
	// yet), receive (live address), transfer / issue / contracts (honest coming
	// states). Same DashboardView visual language.
	import { Gem, ArrowDownToLine, ArrowLeftRight, PlusCircle, FileText } from '@lucide/svelte';
	import { nav } from '$lib/stores/navigation.svelte';
	import AddressCard from '../shell/AddressCard.svelte';
	import ComingSoon from '../shell/ComingSoon.svelte';
	import EmptyList from '../shell/EmptyList.svelte';

	const view = $derived(nav.activeView);
</script>

{#if view === 'assets'}
	<EmptyList icon={Gem} title="RGB assets" />
{:else if view === 'receive'}
	<AddressCard tab="rgb" label="Your RGB receive address" />
{:else if view === 'transfer'}
	<ComingSoon icon={ArrowLeftRight} title="Transfer" detail="Issuer-namespaced RGB transfers arrive with extro-node." />
{:else if view === 'issue'}
	<ComingSoon icon={PlusCircle} title="Issue asset" detail="Contract issuance arrives with extro-node." />
{:else if view === 'contracts'}
	<ComingSoon icon={FileText} title="Contracts" detail="Contract listing arrives with extro-node." />
{/if}
