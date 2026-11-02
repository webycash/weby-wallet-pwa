<script lang="ts">
	// Sites signed in with this Extro identity (ADR-0008). Each stays
	// connected until disconnected here, on another of the user's devices
	// (synced through the wallet home), or from the site itself.
	import { onMount } from 'svelte';
	import type { Connection } from '@extro/node';
	import { getMnemonic } from '$lib/core/persistence';
	import { unlockExtroWallet } from '$lib/extro/seed';
	import { getRuntimeConfig } from '$lib/extro/release-config';
	import {
		activeConnections,
		disconnect,
		listConnections,
		syncNow,
		type SyncStatus
	} from '$lib/extro/connections';
	import { clearBudget, pruneBudgets, viewBudget, type BudgetView } from '$lib/extro/spend-budget';

	let items = $state<Connection[] | null>(null);
	let sync = $state<SyncStatus | 'syncing'>('syncing');
	let busy = $state<string | null>(null);
	let message = $state('');
	/** Daily spend budgets set on this device, by connection id. */
	let budgets = $state<Record<string, BudgetView | null>>({});

	function loadBudgets(list: Connection[]) {
		// A budget belongs to one sign-in: drop those of gone connections.
		pruneBudgets(localStorage, list.map((c) => c.id_hex));
		budgets = Object.fromEntries(list.map((c) => [c.id_hex, viewBudget(localStorage, c.id_hex)]));
	}

	function removeBudget(c: Connection) {
		clearBudget(localStorage, c.id_hex);
		budgets = { ...budgets, [c.id_hex]: null };
	}

	const nameOf = (origin: string) => getRuntimeConfig().connected_apps.find((a) => a.origin === origin)?.name ?? origin;
	const since = (unix: number) => new Date(unix * 1000).toLocaleString();

	async function refresh() {
		message = '';
		try {
			if (!(await unlockExtroWallet(getMnemonic()))) throw new Error('no recovery phrase on this device');
			sync = 'syncing';
			sync = await syncNow();
			items = activeConnections(await listConnections());
			loadBudgets(items);
		} catch (e) {
			if (sync === 'syncing') sync = 'failed';
			message = String(e instanceof Error ? e.message : e);
		}
	}

	async function remove(c: Connection) {
		busy = c.id_hex;
		try {
			sync = await disconnect(c.id_hex);
			items = activeConnections(await listConnections());
			loadBudgets(items);
		} catch (e) {
			message = String(e instanceof Error ? e.message : e);
		} finally {
			busy = null;
		}
	}

	onMount(refresh);
</script>

<div class="mt-4 rounded-xl border border-border p-4" data-testid="connected-sites">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">Connected sites</h3>
		<button class="text-xs underline opacity-70" onclick={refresh} data-testid="connected-sites-refresh">Sync</button>
	</div>
	<p class="text-muted-foreground mt-1 text-xs">
		Sites signed in with your Extro identity. They stay connected until you disconnect them; a disconnect
		here applies on all your devices.
	</p>
	{#if items === null}
		<p class="mt-2 text-xs opacity-70">Loading…</p>
	{:else if items.length === 0}
		<p class="mt-2 text-sm" data-testid="connected-sites-empty">No connected sites.</p>
	{:else}
		<ul class="mt-2 space-y-2">
			{#each items as c (c.id_hex)}
				<li class="flex items-start justify-between gap-2" data-testid="connected-site" data-origin={c.aud} data-id={c.id_hex}>
					<div class="min-w-0">
						<p class="text-sm font-medium">{nameOf(c.aud)}</p>
						<p class="font-mono text-xs break-all opacity-70">{c.aud}</p>
						<p class="text-xs opacity-70">{c.scopes.join(' · ')} — since {since(c.connected_at)}</p>
						{#if budgets[c.id_hex]}
							{@const b = budgets[c.id_hex]!}
							<p class="text-xs" data-testid="connected-site-budget" data-amount={b.amount}>
								Pays without asking up to {b.amount} webcash per {b.window_secs === 86400 ? '24 hours' : `${b.window_secs} s`}
								on this device ({b.used} used).
								<button class="underline" onclick={() => removeBudget(c)} data-testid="connected-site-budget-remove">Remove</button>
							</p>
						{:else}
							<p class="text-xs opacity-70">Every payment asks first.</p>
						{/if}
					</div>
					<button
						class="shrink-0 rounded-md border border-border px-2 py-1 text-xs"
						disabled={busy !== null}
						onclick={() => remove(c)}
						data-testid="connected-site-disconnect">{busy === c.id_hex ? 'Disconnecting…' : 'Disconnect'}</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="mt-2 text-xs opacity-70" data-testid="connected-sites-sync" data-sync={sync}>
		{#if sync === 'synced'}In sync with your other devices.
		{:else if sync === 'syncing'}Syncing…
		{:else if sync === 'unavailable'}Sync unavailable here — changes stay on this device until it syncs.
		{:else}Sync failed — will retry next time.{/if}
	</p>
	{#if message}<p class="mt-2 text-xs" data-testid="connected-sites-message">{message}</p>{/if}
</div>
