<script lang="ts">
	// Bitcoin asset-tab shell. Views: balance (LIVE via esplora), receive (LIVE
	// address), send (LIVE dispatch → pending until the native send pkg lands),
	// ark / history (honest coming states). Style matches DashboardView: balance
	// hero + pills + rounded cards, Amethyst theme, animate-fade-in.
	import { ArrowDownToLine, ArrowUpFromLine, Anchor, History } from '@lucide/svelte';
	import { nav } from '$lib/stores/navigation.svelte';
	import type { NetworkMode } from '$lib/core/types';
	import { deriveFamilyAddress, type FamilyAddress } from '$lib/extro/family';
	import { bitcoinBalance, bitcoinSend, type RailOutcome } from '$lib/extro/rail';
	import type { ResponseBody } from '$lib/extro/commands';
	import BalanceHero from '../shell/BalanceHero.svelte';
	import ActionPills from '../shell/ActionPills.svelte';
	import AddressCard from '../shell/AddressCard.svelte';
	import ComingSoon from '../shell/ComingSoon.svelte';
	import RailActionForm from '../shell/RailActionForm.svelte';
	import Loader from '$lib/components/ui/Loader.svelte';

	let { network }: { network: NetworkMode } = $props();

	const view = $derived(nav.activeView);

	type BtcBal = Extract<ResponseBody, { kind: 'BitcoinBalance' }>;
	// LIVE confirmed balance from esplora via the Op::Rail BitcoinBalance command.
	let bal = $state<RailOutcome<BtcBal> | null>(null);
	$effect(() => {
		let cancelled = false;
		bal = null;
		bitcoinBalance().then((r) => { if (!cancelled) bal = r; });
		return () => { cancelled = true; };
	});

	// sats → BTC display (8dp, trimmed). confirmed_sats is a bigint.
	const display = $derived.by(() => {
		if (bal?.state !== 'ok') return '0';
		const sats = bal.value.confirmed_sats;
		const btc = Number(sats) / 1e8;
		return btc === 0 ? '0' : btc.toFixed(8).replace(/\.?0+$/, '');
	});

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

	const sendFields = [
		{ key: 'to', label: 'Recipient address', placeholder: 'tb1… / bc1…', mono: true },
		{ key: 'amount_sat', label: 'Amount (sats)', placeholder: 'Amount in satoshis', type: 'number' as const },
		{ key: 'fee_rate', label: 'Fee rate (sat/vB)', placeholder: 'Fee rate', type: 'number' as const },
	];
	const onSend = (v: Record<string, string>) =>
		bitcoinSend({ to: v.to, amountSat: BigInt(v.amount_sat), feeRateSatPerVb: BigInt(v.fee_rate) });
</script>

{#if view === 'balance'}
	<div class="space-y-3">
		{#if bal === null}
			<div class="flex justify-center py-16"><Loader /></div>
		{:else if bal.state === 'error'}
			<BalanceHero symbol="₿" display="0" {network} />
			<p class="text-center text-[12px] text-destructive break-all">Balance unavailable — {bal.message}</p>
		{:else if bal.state === 'pending'}
			<BalanceHero symbol="₿" display="—" {network} />
			<p class="text-center text-[12px] text-muted-foreground/70">Balance via extro-node · pending</p>
		{:else}
			<BalanceHero symbol="₿" {display} {network} />
		{/if}
		{#if addr?.ok}
			<p class="text-center text-[12px] text-muted-foreground/70 tabular-nums break-all">{short(addr.address)}</p>
		{/if}
		<ActionPills {actions} />
	</div>
{:else if view === 'receive'}
	<AddressCard tab="bitcoin" label="Your Bitcoin address" />
{:else if view === 'send'}
	<RailActionForm
		icon={ArrowUpFromLine}
		title="Send Bitcoin"
		fields={sendFields}
		submitLabel="Send"
		onSubmit={onSend}
		formatOk={(v) => {
			const s = v as Extract<ResponseBody, { kind: 'BitcoinSent' }>;
			return `Broadcast ${s.txid} · fee ${s.fee_sat} sat`;
		}}
	/>
{:else if view === 'ark'}
	<ComingSoon icon={Anchor} title="ARK" detail="Lock and unilateral exit arrive with extro-node's ARK verify/settle." />
{:else if view === 'history'}
	<ComingSoon icon={History} title="History" detail="Per-asset history arrives with extro-node's wallet summaries." />
{/if}
