<script lang="ts">
	import { Anchor } from '@lucide/svelte';
	import { loadArkOverview, type ArkOverview } from '$lib/ark/ark-view';
	import { arkStatus } from '$lib/ark/ark-status.svelte';
	import Loader from '$lib/components/ui/Loader.svelte';
	import { boardArk } from '$lib/ark/board';

	let data = $state<ArkOverview | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);

	const load = async () => {
		loading = true;
		error = null;
		try {
			data = await loadArkOverview();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	};
	$effect(() => {
		void load();
	});
	let boarding = $state(false);
	let boardMsg = $state<string | null>(null);
	const board = async () => {
		if (!data) return;
		boarding = true;
		boardMsg = 'Joining the next ASP round…';
		try {
			const r = await boardArk(data.boardingAddress, (e) => (boardMsg = `ASP round: ${e.type}`));
			boardMsg = `Boarded ${r.boardedSats.toLocaleString()} sat · Ark tx ${r.arkTxId}`;
			await load();
		} catch (e) {
			boardMsg = `Boarding failed: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			boarding = false;
		}
	};
	const fmt = (s: number) => `${s.toLocaleString()} sat`;
	const copy = (t: string) => navigator.clipboard?.writeText(t);
</script>

<div class="animate-fade-in space-y-3" data-testid="ark-view">
	<div class="flex items-center gap-2 text-[14px] font-semibold">
		<Anchor size={16} /> Bitcoin ARK
		{#if data}<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 uppercase">{data.network}</span>{/if}
		<button class="ml-auto text-[11px] text-primary" onclick={load} disabled={loading}>Refresh</button>
	</div>

	{#if arkStatus.ok === false && !/disabled in runtime/.test(arkStatus.reason ?? '')}
		<div class="rounded-xl bg-warning/10 px-3 py-2 text-[12px] text-warning">ARK unavailable: {arkStatus.reason}</div>
	{:else if loading && !data}
		<Loader />
	{:else if error}
		<div data-testid="ark-error" class="rounded-xl bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div>
	{/if}

	{#if data}
		<div class="rounded-2xl bg-muted/20 px-4 py-3 space-y-1">
			<div class="text-[11px] text-muted-foreground">Off-chain (VTXO) balance</div>
			<div data-testid="ark-balance" class="text-[22px] font-semibold tabular-nums">{fmt(data.offchainSats)}</div>
			<div class="text-[11px] text-muted-foreground" data-testid="ark-boarding-balance">
				Boarding: {fmt(data.boardingSats)} confirmed{data.boardingUnconfirmedSats
					? ` · ${fmt(data.boardingUnconfirmedSats)} unconfirmed`
					: ''}
			</div>
			{#if data.boardingSats > 0}
				<button
					data-testid="ark-board"
					class="mt-1 rounded-md border border-border px-3 py-1 text-[12px]"
					onclick={board}
					disabled={boarding}>{boarding ? 'Boarding…' : 'Board via ASP'}</button
				>
			{/if}
			{#if boardMsg}<div class="text-[11px] break-all" data-testid="ark-board-message">{boardMsg}</div>{/if}
		</div>
		<div class="rounded-2xl bg-muted/20 px-4 py-3 space-y-2 text-[11px]">
			<div>
				<div class="text-muted-foreground">Receive (Ark address)</div>
				<button data-testid="ark-address" class="font-mono break-all text-left" onclick={() => copy(data!.arkAddress)}>{data.arkAddress}</button>
			</div>
			<div>
				<div class="text-muted-foreground">Boarding address (on-chain {data.network})</div>
				<button data-testid="ark-boarding-address" class="font-mono break-all text-left" onclick={() => copy(data!.boardingAddress)}>{data.boardingAddress}</button>
			</div>
			<div class="text-muted-foreground">ASP: {data.asp}</div>
		</div>
		<div class="rounded-2xl bg-muted/20 px-4 py-3 text-[11px]" data-testid="ark-vtxos">
			<div class="text-muted-foreground mb-1">VTXOs ({data.vtxos.length})</div>
			{#each data.vtxos as v (v.outpoint)}
				<div class="flex justify-between font-mono gap-2">
					<span class="truncate">{v.outpoint}</span><span>{fmt(v.sats)} · {v.state}</span>
				</div>
			{:else}
				<div class="text-muted-foreground">No VTXOs yet. Fund the boarding address, then board via the ASP.</div>
			{/each}
		</div>
	{/if}
</div>
