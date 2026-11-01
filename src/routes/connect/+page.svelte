<script lang="ts">
	// Wallet connect popup (ADR-0008). A connected app opens this page with
	// window.open; it asks the user once per grant (connect) and once per
	// value-moving request (confirm). The seed never leaves this origin.
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import LockScreen from '$lib/components/wallet/LockScreen.svelte';
	import { encryptionType, licenseAccepted, walletExists } from '$lib/stores/settings.svelte';
	import { getMnemonic } from '$lib/core/persistence';
	import { unlockExtroWallet } from '$lib/extro/seed';
	import { describeOp, startConnectHost } from '$lib/extro/connect-host';
	import type { ConnectedApp, ConsentRequest, Op, WalletConnectHost } from '@extro/node';

	type Question = { kind: 'consent'; request: ConsentRequest } | { kind: 'confirm'; app: ConnectedApp; op: Op };
	type Prompt = Question & { answer: (ok: boolean) => void };

	const hasWallet = browser && walletExists() && licenseAccepted();
	let unlocked = $state(browser && encryptionType() === 'none');
	let status = $state<'locked' | 'starting' | 'serving' | 'not-opened' | 'failed'>('locked');
	let prompt = $state<Prompt | null>(null);
	let host: WalletConnectHost | null = null;

	const ask = (q: Question) =>
		new Promise<boolean>((resolve) => {
			prompt = {
				...q,
				answer: (ok: boolean) => {
					prompt = null;
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
			confirm: (app, op) => ask({ kind: 'confirm', app, op })
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
				<Card.Title>Connect {request.app.name}?</Card.Title>
				<Card.Description>
					<span class="font-mono" data-testid="connect-origin">{request.app.origin}</span> asks for access for
					{Math.round(request.ttl_secs / 60)} minutes. It never sees your recovery phrase, and every payment
					asks you here first.
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
				<Button data-testid="connect-approve" onclick={() => prompt?.answer(true)}>Connect</Button>
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
			</Card.Content>
			<Card.Footer class="flex gap-2">
				<Button variant="outline" data-testid="confirm-reject" onclick={() => prompt?.answer(false)}>Reject</Button>
				<Button data-testid="confirm-approve" onclick={() => prompt?.answer(true)}>Confirm</Button>
			</Card.Footer>
		</Card.Root>
	{:else}
		<p class="text-center text-sm opacity-70" data-testid="connect-status" data-status={status}>
			{#if status === 'serving'}Connected — keep this window open while the app uses your wallet.
			{:else if status === 'not-opened'}This page only works when a connected site opens it.
			{:else if status === 'failed'}The wallet could not start. Close this window and try again.
			{:else}Starting the wallet…{/if}
		</p>
	{/if}
</main>
