<script lang="ts">
	// Wallet home: receive a wallet moved from a legacy wallet origin (ADR-0008
	// §12). The legacy page opens this popup; @extro/node's migrate host accepts
	// one handoff from that exact opener (configured legacy_wallet_origins only)
	// and checks its digest. Nothing is stored until the user confirms here, and
	// only into an empty wallet. The node is not booted on this page (+layout.ts)
	// so its store is written at rest; the wallet opens afterwards.
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import { getRuntimeConfig } from '$lib/extro/release-config';
	import {
		browserMoveStorage,
		homeIsEmpty,
		importMoveBundle,
		parseMoveBundle,
		summarizeMove,
		WalletMoveError,
		type MoveSummary
	} from '$lib/core/wallet-move';
	import { installWalletMigrateHost, WalletMigrateError, type WalletMigrateHost } from '@extro/node';

	type Ask = { summary: MoveSummary; answer: (ok: boolean) => void };
	let status = $state<'waiting' | 'not-opened' | 'not-empty' | 'importing' | 'done' | 'failed' | 'rejected'>('waiting');
	let ask = $state<Ask | null>(null);
	let done = $state<MoveSummary | null>(null);
	let host: WalletMigrateHost | null = null;

	const PROTECTION_TEXT: Record<MoveSummary['protection'], string> = {
		none: 'Not encrypted on this device — same as before.',
		password: 'Still encrypted: unlock it here with the same password.',
		reprotect: 'Your passkey belongs to the old site, so the wallet arrives unlocked. Set a passkey or password in Settings → Security right after.'
	};

	onMount(() => {
		document.getElementById('app-loader')?.remove();
		const root = document.getElementById('app-root');
		if (root) root.style.opacity = '1';
		if (!browser) return;
		const config = getRuntimeConfig();
		host = installWalletMigrateHost({
			config,
			selfOrigin: location.origin,
			receive: async (offer) => {
				let bundle;
				try {
					bundle = parseMoveBundle(offer.payload);
				} catch (e) {
					status = 'failed';
					throw new WalletMigrateError('MalformedRequest', e instanceof Error ? e.message : 'bad bundle');
				}
				if (bundle.from !== offer.from) {
					status = 'failed';
					throw new WalletMigrateError('MalformedRequest', 'bundle origin does not match its sender');
				}
				if (!homeIsEmpty(browserMoveStorage)) {
					status = 'not-empty';
					throw new WalletMigrateError('HomeNotEmpty', 'this device already has a wallet here');
				}
				const ok = await new Promise<boolean>((resolve) => {
					ask = {
						summary: summarizeMove(bundle),
						answer: (v) => {
							ask = null;
							resolve(v);
						}
					};
				});
				if (!ok) {
					status = 'rejected';
					throw new WalletMigrateError('UserRejected', 'the user declined the move');
				}
				status = 'importing';
				try {
					done = await importMoveBundle(browserMoveStorage, bundle, { nodeDbName: config.db_name });
					status = 'done';
				} catch (e) {
					status = e instanceof WalletMoveError && e.code === 'home_not_empty' ? 'not-empty' : 'failed';
					throw new WalletMigrateError(
						status === 'not-empty' ? 'HomeNotEmpty' : 'WalletError',
						e instanceof Error ? e.message : String(e)
					);
				}
			}
		});
		if (!host) status = 'not-opened';
	});
	onDestroy(() => host?.stop());
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4" data-testid="wallet-migrate" data-status={status}>
	{#if ask}
		{@const s = ask.summary}
		<Card.Root data-testid="migrate-confirm">
			<Card.Header>
				<Card.Title>Move your wallet here?</Card.Title>
				<Card.Description>
					From <span class="font-mono" data-testid="migrate-from">{s.from}</span> on this device. It was copied
					between the two windows on this device only — nothing was sent over the network.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2 text-sm">
				<p>{s.walletEntries} wallet record(s), {s.contracts} swap contract(s), {s.nodeEntries} node record(s).</p>
				<p>{PROTECTION_TEXT[s.protection]}</p>
				<p class="opacity-70">The old site keeps its copy; nothing is deleted there.</p>
			</Card.Content>
			<Card.Footer class="flex gap-2">
				<Button variant="outline" data-testid="migrate-reject" onclick={() => ask?.answer(false)}>Cancel</Button>
				<Button data-testid="migrate-approve" onclick={() => ask?.answer(true)}>Move wallet</Button>
			</Card.Footer>
		</Card.Root>
	{:else if status === 'done' && done}
		<Card.Root data-testid="migrate-done">
			<Card.Header>
				<Card.Title>Wallet moved</Card.Title>
				<Card.Description>{PROTECTION_TEXT[done.protection]}</Card.Description>
			</Card.Header>
			<Card.Footer><Button onclick={() => window.close()}>Close</Button></Card.Footer>
		</Card.Root>
	{:else}
		<p class="text-center text-sm opacity-70" data-testid="migrate-status">
			{#if status === 'not-opened'}This page only works when your old wallet page opens it.
				<a class="underline" href="{base}/">Open the wallet</a>
			{:else if status === 'not-empty'}This device already has a wallet here, so nothing was changed. Keep using the old site, or back up and reset this one first.
			{:else if status === 'rejected'}Cancelled — nothing was changed. You can close this window.
			{:else if status === 'importing'}Saving your wallet…
			{:else if status === 'failed'}The move failed and nothing was marked as moved. Close this window and try again.
			{:else}Waiting for your wallet…{/if}
		</p>
	{/if}
</main>
