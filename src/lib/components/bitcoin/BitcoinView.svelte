<script lang="ts">
	// Bitcoin asset-tab shell. Views: balance (live), receive (live address),
	// send / ark / history (honest coming states). Style matches DashboardView:
	// balance hero + 2-col pills + rounded cards, Amethyst theme, animate-fade-in.
	import { ArrowDownToLine, ArrowUpFromLine, Anchor, History } from '@lucide/svelte';
	import { nav } from '$lib/stores/navigation.svelte';
	import type { NetworkMode } from '$lib/core/types';
	import { deriveFamilyAddress, type FamilyAddress } from '$lib/extro/family';
	import BalanceHero from '../shell/BalanceHero.svelte';
	import ActionPills from '../shell/ActionPills.svelte';
	import AddressCard from '../shell/AddressCard.svelte';
	import ComingSoon from '../shell/ComingSoon.svelte';

	let { balanceWats, network, label }: {
		balanceWats: number;
		network: NetworkMode;
		label: string;
	} = $props();

	const view = $derived(nav.activeView);
	const display = $derived((balanceWats / 1e8).toFixed(balanceWats === 0 ? 2 : 8).replace(/\.?0+$/, '') || '0');

	const actions = [
		{ label: 'Receive', icon: ArrowDownToLine, view: 'receive' },
		{ label: 'Send', icon: ArrowUpFromLine, view: 'send' },
	] as const;

	// Family address shown under the balance hero (live via the extro facade).
	let addr = $state<FamilyAddress | null>(null);
	$effect(() => {
		let cancelled = false;
		deriveFamilyAddress('bitcoin').then((r) => { if (!cancelled) addr = r; });
		return () => { cancelled = true; };
	});
	const short = (a: string) => (a.length > 22 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a);
</script>

{#if view === 'balance'}
	<div class="space-y-3">
		<BalanceHero symbol="₿" display={display} {network} />
		{#if addr?.ok}
			<p class="text-center text-[12px] text-muted-foreground/70 tabular-nums break-all">{short(addr.address)}</p>
		{/if}
		<ActionPills {actions} />
	</div>
{:else if view === 'receive'}
	<AddressCard tab="bitcoin" label="Your Bitcoin address" />
{:else if view === 'send'}
	<ComingSoon icon={ArrowUpFromLine} title="Send Bitcoin" detail="On-chain and ARK sends arrive with extro-node's Scheme-402 SimplePay." />
{:else if view === 'ark'}
	<ComingSoon icon={Anchor} title="ARK" detail="Lock and unilateral exit arrive with extro-node's ARK verify/settle." />
{:else if view === 'history'}
	<ComingSoon icon={History} title="History" detail="Per-asset history arrives with extro-node's wallet summaries." />
{/if}
