<script lang="ts">
	// RGB asset-tab shell. Views: assets (LIVE balance dispatch), receive (LIVE
	// address), transfer / issue (LIVE dispatch forms → pending until the native
	// rail pkg lands), contracts (LIVE contracts dispatch). Same DashboardView
	// visual language.
	//
	// NOTE: there is no RGB bearer-token store in the PWA yet, so the balance /
	// contracts dispatches pass `[]`. Once a token store lands, feed it here (a
	// one-line change) — the command surface is already correct.
	import { Gem, ArrowLeftRight, PlusCircle, FileText } from '@lucide/svelte';
	import { nav } from '$lib/stores/navigation.svelte';
	import { rgbBalance, rgbContracts, rgbIssue, rgbTransfer, type RailOutcome } from '$lib/extro/rail';
	import type { ResponseBody } from '$lib/extro/commands';
	import AddressCard from '../shell/AddressCard.svelte';
	import RailActionForm from '../shell/RailActionForm.svelte';
	import RailBalanceList from '../shell/RailBalanceList.svelte';

	const view = $derived(nav.activeView);

	type Balance = Extract<ResponseBody, { kind: 'RailBalance' }>;
	type Contracts = Extract<ResponseBody, { kind: 'RailContracts' }>;
	let assets = $state<RailOutcome<Balance> | null>(null);
	let contracts = $state<RailOutcome<Contracts> | null>(null);

	$effect(() => {
		if (view !== 'assets') return;
		let cancelled = false;
		assets = null;
		rgbBalance([]).then((r) => { if (!cancelled) assets = r; });
		return () => { cancelled = true; };
	});
	$effect(() => {
		if (view !== 'contracts') return;
		let cancelled = false;
		contracts = null;
		rgbContracts([]).then((r) => { if (!cancelled) contracts = r; });
		return () => { cancelled = true; };
	});

	const flavorField = {
		key: 'flavor',
		label: 'Flavor',
		type: 'select' as const,
		options: [
			{ value: 'Fungible', label: 'RGB20 (fungible)' },
			{ value: 'Collectible', label: 'RGB21 (collectible)' },
		],
	};
	const issueFields = [
		flavorField,
		{ key: 'amount', label: 'Amount', placeholder: 'RGB20 amount (ignored for RGB21)', type: 'number' as const },
		{ key: 'contract', label: 'Contract', placeholder: 'Series name' },
	];
	const transferFields = [
		flavorField,
		{ key: 'input', label: 'Held secret', placeholder: 'Bearer secret to spend', mono: true },
		{ key: 'recipient', label: 'Recipient output', placeholder: 'Recipient-owned secret', mono: true },
	];

	const flavorOf = (v: string) => (v === 'Collectible' ? 'Collectible' : 'Fungible') as 'Fungible' | 'Collectible';
	const onIssue = (v: Record<string, string>) =>
		rgbIssue({ flavor: flavorOf(v.flavor), amount: v.amount, contract: v.contract });
	const onTransfer = (v: Record<string, string>) =>
		rgbTransfer({ flavor: flavorOf(v.flavor), input: v.input, recipient: v.recipient });
</script>

{#if view === 'assets'}
	<RailBalanceList icon={Gem} title="RGB assets" outcome={assets} />
{:else if view === 'receive'}
	<AddressCard tab="rgb" label="Your RGB address" />
{:else if view === 'transfer'}
	<RailActionForm
		icon={ArrowLeftRight}
		title="Transfer RGB"
		fields={transferFields}
		submitLabel="Transfer"
		onSubmit={onTransfer}
		formatOk={(v) => {
			const r = v as Extract<ResponseBody, { kind: 'RailTransferred' }>;
			return `Transferred · ${r.scheme}`;
		}}
	/>
{:else if view === 'issue'}
	<RailActionForm
		icon={PlusCircle}
		title="Issue RGB asset"
		fields={issueFields}
		submitLabel="Issue"
		onSubmit={onIssue}
		formatOk={(v) => {
			const r = v as Extract<ResponseBody, { kind: 'RailIssued' }>;
			return `Issued ${r.contract} · ${r.secret}`;
		}}
	/>
{:else if view === 'contracts'}
	<RailBalanceList icon={FileText} title="Contracts" outcome={contracts} />
{/if}
