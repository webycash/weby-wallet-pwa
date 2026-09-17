<script lang="ts">
	// Vouchers asset-tab shell. Views: vouchers (LIVE balance dispatch → groups /
	// pending / error), receive (LIVE address), issue / transfer / redeem (LIVE
	// dispatch forms → pending until the native rail pkg lands), history (honest
	// coming state). Same DashboardView visual language.
	//
	// NOTE: there is no voucher bearer-token store in the PWA yet, so the balance
	// dispatch passes `[]`. Once a token store lands, feed it here (one-line
	// change) — the command surface is already correct.
	import { Ticket, Gift, ArrowLeftRight, PlusCircle, History } from '@lucide/svelte';
	import { nav } from '$lib/stores/navigation.svelte';
	import { voucherBalance, voucherIssue, voucherTransfer, voucherRedeem, type RailOutcome } from '$lib/extro/rail';
	import type { ResponseBody } from '$lib/extro/commands';
	import AddressCard from '../shell/AddressCard.svelte';
	import ComingSoon from '../shell/ComingSoon.svelte';
	import RailActionForm from '../shell/RailActionForm.svelte';
	import RailBalanceList from '../shell/RailBalanceList.svelte';

	const view = $derived(nav.activeView);

	type Balance = Extract<ResponseBody, { kind: 'RailBalance' }>;
	let bal = $state<RailOutcome<Balance> | null>(null);
	$effect(() => {
		let cancelled = false;
		bal = null;
		voucherBalance([]).then((r) => { if (!cancelled) bal = r; });
		return () => { cancelled = true; };
	});

	const issueFields = [
		{ key: 'amount', label: 'Amount', placeholder: 'e.g. 50.0', type: 'number' as const },
		{ key: 'contract', label: 'Contract', placeholder: 'Series name' },
	];
	const transferFields = [
		{ key: 'input', label: 'Held secret', placeholder: 'Bearer secret to spend', mono: true },
		{ key: 'recipient', label: 'Recipient output', placeholder: 'Recipient-owned secret', mono: true },
	];
	const redeemFields = [
		{ key: 'secret', label: 'Bearer secret', placeholder: 'Secret to verify', mono: true },
	];

	const onIssue = (v: Record<string, string>) => voucherIssue({ amount: v.amount, contract: v.contract });
	const onTransfer = (v: Record<string, string>) => voucherTransfer({ input: v.input, recipient: v.recipient });
	const onRedeem = (v: Record<string, string>) => voucherRedeem(v.secret);
</script>

{#if view === 'vouchers'}
	<RailBalanceList icon={Ticket} title="Vouchers" outcome={bal} />
{:else if view === 'receive'}
	<AddressCard tab="vouchers" label="Your voucher receive address" />
{:else if view === 'redeem'}
	<RailActionForm
		icon={Gift}
		title="Redeem voucher"
		fields={redeemFields}
		submitLabel="Check"
		onSubmit={onRedeem}
		formatOk={(v) => {
			const r = v as Extract<ResponseBody, { kind: 'RailRedeemed' }>;
			return r.unspent ? `Unspent · ${r.public_token}` : `Spent or unknown · ${r.public_token}`;
		}}
	/>
{:else if view === 'issue'}
	<RailActionForm
		icon={PlusCircle}
		title="Issue voucher"
		fields={issueFields}
		submitLabel="Issue"
		onSubmit={onIssue}
		formatOk={(v) => {
			const r = v as Extract<ResponseBody, { kind: 'RailIssued' }>;
			return `Issued ${r.contract} · ${r.secret}`;
		}}
	/>
{:else if view === 'transfer'}
	<RailActionForm
		icon={ArrowLeftRight}
		title="Transfer voucher"
		fields={transferFields}
		submitLabel="Transfer"
		onSubmit={onTransfer}
		formatOk={(v) => {
			const r = v as Extract<ResponseBody, { kind: 'RailTransferred' }>;
			return `Transferred · ${r.scheme}`;
		}}
	/>
{:else if view === 'history'}
	<ComingSoon icon={History} title="History" detail="Per-asset history arrives with extro-node." />
{/if}
