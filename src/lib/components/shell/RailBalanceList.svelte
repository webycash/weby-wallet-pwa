<script lang="ts">
	// Rail balance/contracts list — renders a {@link RailOutcome} of a list-shaped
	// rail read (Voucher balance, RGB balance, RGB contracts) honestly:
	//
	//   * loading → loader.
	//   * pending → clean "via extro-node (pending)" state (NOT fake data).
	//   * error   → the real error.
	//   * ok      → the grouped rows, or an honest "none yet" empty state.
	//
	// Accepts either a `RailBalance` (groups) or a `RailContracts` (contracts)
	// outcome — both project to the same `(scheme, contract, issuer_fp)` rows; a
	// `RailBalance` group additionally carries `count`/`total`.
	import type { Component } from 'svelte';
	import Loader from '$lib/components/ui/Loader.svelte';
	import type { RailOutcome } from '$lib/extro/rail';
	import type { ResponseBody, RailBalanceGroup, RailContract } from '$lib/extro/commands';

	type ListBody =
		| Extract<ResponseBody, { kind: 'RailBalance' }>
		| Extract<ResponseBody, { kind: 'RailContracts' }>;

	let { icon, title, outcome }: {
		icon: Component;
		title: string;
		outcome: RailOutcome<ListBody> | null;
	} = $props();

	const Icon = $derived(icon);

	const rows = $derived.by((): (RailBalanceGroup | RailContract)[] => {
		if (outcome?.state !== 'ok') return [];
		return outcome.value.kind === 'RailBalance' ? outcome.value.groups : outcome.value.contracts;
	});
	const hasTotal = (r: RailBalanceGroup | RailContract): r is RailBalanceGroup => 'total' in r;
</script>

{#if outcome === null}
	<div class="flex justify-center py-16"><Loader /></div>
{:else if outcome.state === 'pending'}
	<div class="animate-fade-in max-w-sm mx-auto w-full pt-8">
		<div class="rounded-3xl bg-muted/40 px-6 py-14 text-center">
			<div class="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-5">
				<Icon class="w-7 h-7 text-muted-foreground" />
			</div>
			<h3 class="text-[17px] font-medium text-foreground mb-2">{title}</h3>
			<p class="text-[13px] text-muted-foreground leading-relaxed mb-4">
				Wired to extro-node — listing is native-only until the rail pkg lands.
			</p>
			<span class="inline-block rounded-full bg-background px-4 py-1.5 text-[11px] font-medium text-muted-foreground tracking-wide">
				via extro-node · pending
			</span>
		</div>
	</div>
{:else if outcome.state === 'error'}
	<div class="animate-fade-in max-w-sm mx-auto w-full pt-8">
		<div class="rounded-3xl bg-destructive/5 px-6 py-10 text-center">
			<p class="text-[13px] text-destructive leading-relaxed break-all">{outcome.message}</p>
		</div>
	</div>
{:else if rows.length === 0}
	<div class="animate-fade-in max-w-sm mx-auto w-full pt-8">
		<div class="rounded-3xl bg-muted/40 px-6 py-14 text-center">
			<div class="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-5">
				<Icon class="w-7 h-7 text-muted-foreground" />
			</div>
			<h3 class="text-[17px] font-medium text-foreground mb-2">{title}</h3>
			<p class="text-[13px] text-muted-foreground leading-relaxed">None yet.</p>
		</div>
	</div>
{:else}
	<div class="animate-fade-in max-w-sm mx-auto w-full pt-4 space-y-2">
		{#each rows as row (row.scheme + row.contract + row.issuer_fp)}
			<div class="rounded-2xl bg-muted/40 px-5 py-4 flex items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="text-[14px] font-medium text-foreground truncate">{row.contract}</p>
					<p class="text-[11px] text-muted-foreground/70 truncate tabular-nums">{row.scheme} · {row.issuer_fp}</p>
				</div>
				{#if hasTotal(row)}
					<p class="text-[14px] font-medium text-foreground tabular-nums shrink-0">
						{row.total !== '' ? row.total : `×${row.count}`}
					</p>
				{/if}
			</div>
		{/each}
	</div>
{/if}
