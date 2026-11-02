<script lang="ts">
	// Wallet connect popup (ADR-0008). A connected app opens this page with
	// window.open to sign in with the user's Extro identity (asked once; the
	// connection lasts until the user disconnects it) and for each
	// value-moving request (confirm), unless the spend fits a budget the user
	// set for that site. The seed never leaves this origin. The window does
	// not have to stay open: the site keeps its sign-in and opens the wallet
	// again from the user's next click (Safari-safe: no iframe, no 3P storage).
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import LockScreen from '$lib/components/wallet/LockScreen.svelte';
	import { encryptionType, licenseAccepted, walletExists } from '$lib/stores/settings.svelte';
	import { getMnemonic } from '$lib/core/persistence';
	import { unlockExtroWallet } from '$lib/extro/seed';
	import { describeOp, startConnectHost } from '$lib/extro/connect-host';
	import { getRuntimeConfig } from '$lib/extro/release-config';
	import { budgetedWats, DAY_SECS, setBudget, watsToWebcash } from '$lib/extro/spend-budget';
	import type { ConnectedApp, Connection, ConsentRequest, Op, WalletConnectHost } from '@extro/node';

	type Question =
		| { kind: 'consent'; request: ConsentRequest }
		| { kind: 'confirm'; app: ConnectedApp; op: Op; connection: Connection };
	type Prompt = Question & { answer: (ok: boolean) => void };

	const hasWallet = browser && walletExists() && licenseAccepted();
	let unlocked = $state(browser && encryptionType() === 'none');
	let status = $state<'locked' | 'starting' | 'serving' | 'not-opened' | 'failed'>('locked');
	let prompt = $state<Prompt | null>(null);
	let host: WalletConnectHost | null = null;
	/** Served at least one request: the site may close this window now. */
	let served = $state(false);
	/** Offer on a budget-eligible confirm: "don't ask again up to N per day". */
	let allowBudget = $state(false);
	let budgetAmount = $state('');
	let budgetError = $state('');

	const budgetable = (op: Op) => budgetedWats(op, getRuntimeConfig().webcash_server_url);

	const ask = (q: Question) =>
		new Promise<boolean>((resolve) => {
			if (q.kind === 'confirm') {
				const wats = budgetable(q.op);
				allowBudget = false;
				budgetError = '';
				// Suggest ten such payments; the user edits it, nothing is preset on.
				budgetAmount = wats === null ? '' : watsToWebcash(wats * 10n);
			}
			prompt = {
				...q,
				answer: (ok: boolean) => {
					if (ok && q.kind === 'confirm' && allowBudget) {
						try {
							setBudget(localStorage, q.connection.id_hex, budgetAmount.trim(), DAY_SECS);
						} catch (e) {
							budgetError = e instanceof Error ? e.message : String(e);
							return;
						}
					}
					prompt = null;
					served = true;
					resolve(ok);
				}
			};
		});

	async function serve() {
		status = 'starting';
		try {
			if (!(await unlockExtroWallet(getMnemonic()))) throw new Error('no recovery phrase on this device');
		} catch {
			status = 'failed';
			return;
		}
		host = startConnectHost({
			consent: (request) => ask({ kind: 'consent', request }),
			confirm: (app, op, connection) => ask({ kind: 'confirm', app, op, connection })
		});
		status = host ? 'serving' : 'not-opened';
	}

	$effect(() => {
		if (browser && hasWallet && unlocked && status === 'locked') void serve();
	});

	onMount(() => {
		document.getElementById('app-loader')?.remove();
		const root = document.getElementById('app-root');
		if (root) root.style.opacity = '1';
	});
	onDestroy(() => host?.stop());

	const TIER_TEXT: Record<string, string> = {
		read: 'See your public identity and balances',
		act: 'Sign and publish as you (no payments)'
	};
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4" data-testid="wallet-connect">
	{#if !hasWallet}
		<Card.Root>
			<Card.Header>
				<Card.Title>No wallet on this device</Card.Title>
				<Card.Description>Open the wallet in a tab to create or restore one, then connect again.</Card.Description>
			</Card.Header>
			<Card.Footer><Button onclick={() => window.close()}>Close</Button></Card.Footer>
		</Card.Root>
	{:else if !unlocked}
		<LockScreen onUnlock={() => (unlocked = true)} />
	{:else if prompt?.kind === 'consent'}
		{@const request = prompt.request}
		<Card.Root data-testid="connect-consent">
			<Card.Header>
				<Card.Title>Sign in to {request.app.name} with your Extro identity?</Card.Title>
				<Card.Description>
					<span class="font-mono" data-testid="connect-origin">{request.app.origin}</span> stays connected until you
					disconnect it — from this wallet on any of your devices, or from the site. It never sees your recovery
					phrase, and every payment asks you here first unless you set a daily budget for it.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="list-disc space-y-1 pl-5 text-sm">
					{#each request.scopes as s (s.scope)}
						<li><span class="font-medium">{TIER_TEXT[s.tier]}</span> <span class="font-mono text-xs opacity-70">{s.scope}</span></li>
					{/each}
				</ul>
			</Card.Content>
			<Card.Footer class="flex gap-2">
				<Button variant="outline" data-testid="connect-reject" onclick={() => prompt?.answer(false)}>Cancel</Button>
				<Button data-testid="connect-approve" onclick={() => prompt?.answer(true)}>Sign in</Button>
			</Card.Footer>
		</Card.Root>
	{:else if prompt?.kind === 'confirm'}
		{@const info = describeOp(prompt.op)}
		<Card.Root data-testid="connect-confirm">
			<Card.Header>
				<Card.Title>{prompt.app.name} wants to move value</Card.Title>
				<Card.Description><span class="font-mono">{prompt.app.origin}</span> · {info.title}</Card.Description>
			</Card.Header>
			<Card.Content>
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
					{#each info.fields as [k, v] (k)}
						<dt class="opacity-70">{k}</dt>
						<dd class="font-mono break-all">{v}</dd>
					{/each}
				</dl>
				{#if budgetable(prompt.op) !== null}
					<label class="mt-3 flex items-start gap-2 text-sm" data-testid="confirm-budget">
						<input type="checkbox" class="mt-1" bind:checked={allowBudget} data-testid="confirm-budget-allow" />
						<span>
							Don't ask again: let {prompt.app.name} pay up to
							<input
								class="mx-1 w-24 rounded border border-border bg-transparent px-1 font-mono"
								inputmode="decimal"
								bind:value={budgetAmount}
								disabled={!allowBudget}
								data-testid="confirm-budget-amount"
							/>
							webcash per 24 hours from this wallet without asking. Change or remove it in Settings → Connected sites.
						</span>
					</label>
					{#if budgetError}<p class="mt-1 text-xs text-destructive" data-testid="confirm-budget-error">{budgetError}</p>{/if}
				{/if}
			</Card.Content>
			<Card.Footer class="flex gap-2">
				<Button variant="outline" data-testid="confirm-reject" onclick={() => prompt?.answer(false)}>Reject</Button>
				<Button data-testid="confirm-approve" onclick={() => prompt?.answer(true)}>Confirm</Button>
			</Card.Footer>
		</Card.Root>
	{:else}
		<p class="text-center text-sm opacity-70" data-testid="connect-status" data-status={status}>
			{#if status === 'serving' && served}The site closes this window when it is done. It stays signed in and opens the wallet again on your next action.
			{:else if status === 'serving'}Connected — waiting for the site…
			{:else if status === 'not-opened'}This page only works when a connected site opens it.
			{:else if status === 'failed'}The wallet could not start. Close this window and try again.
			{:else}Starting the wallet…{/if}
		</p>
	{/if}
</main>
