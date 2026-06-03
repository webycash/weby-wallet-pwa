<script lang="ts">
	// Vouchers asset-tab shell. Views: vouchers (honest empty list), receive
	// (live address), redeem / issue / history (honest coming states). Same
	// DashboardView visual language.
	import { Ticket, ArrowDownToLine, Gift, PlusCircle, History } from '@lucide/svelte';
	import { nav } from '$lib/stores/navigation.svelte';
	import AddressCard from '../shell/AddressCard.svelte';
	import ComingSoon from '../shell/ComingSoon.svelte';
	import EmptyList from '../shell/EmptyList.svelte';

	const view = $derived(nav.activeView);
</script>

{#if view === 'vouchers'}
	<EmptyList icon={Ticket} title="Vouchers" />
{:else if view === 'receive'}
	<AddressCard tab="vouchers" label="Your voucher receive address" />
{:else if view === 'redeem'}
	<ComingSoon icon={Gift} title="Redeem" detail="Voucher redemption arrives with extro-node." />
{:else if view === 'issue'}
	<ComingSoon icon={PlusCircle} title="Issue voucher" detail="Voucher issuance arrives with extro-node." />
{:else if view === 'history'}
	<ComingSoon icon={History} title="History" detail="Per-asset history arrives with extro-node." />
{/if}
