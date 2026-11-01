<script lang="ts">
	// Legacy wallet origin: move the wallet stored here to the wallet home
	// (ADR-0008 §12). Browser storage is per origin, so the wallet is copied
	// device-locally: this page opens the home's /migrate popup and hands it the
	// bundle with postMessage (exact origins, digest echoed back). The seed never
	// goes over the network. Only after the home confirms the stored digest is
	// this origin marked as moved; nothing here is ever deleted.
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import LockScreen from '$lib/components/wallet/LockScreen.svelte';
	import { encryptionType, walletExists } from '$lib/stores/settings.svelte';
	import { getRuntimeConfig } from '$lib/extro/release-config';
	import { MOVE_DEFER_KEY, MOVE_NEXT_KEY } from '$lib/core/wallet-home-route';
	import { browserMoveStorage, exportMoveBundle, markMovedTo, readMovedTo, relockAfterMove } from '$lib/core/wallet-move';
	import { WalletMigrateError, WalletMigratePopup } from '@extro/node';

	/** The user's confirmation in the home window is part of this wait. */
	const HANDOFF_TIMEOUT_MS = 10 * 60 * 1000;

	const home = browser ? getRuntimeConfig().wallet_home_origin : '';
	const hasWallet = browser && walletExists();
	const encType = browser ? encryptionType() : 'none';
	// A password vault moves encrypted (no unlock); a passkey is bound to this
	// origin, so that wallet must be unlocked to move.
	let unlocked = $state(encType !== 'passkey');
	let status = $state<'ready' | 'moving' | 'moved' | 'failed'>(browser && readMovedTo() ? 'moved' : 'ready');
	let error = $state('');

	const next = () => {
		const n = sessionStorage.getItem(MOVE_NEXT_KEY);
		return n && n.startsWith(`${base}/`) && !n.startsWith(`${base}/move`) ? n : `${base}/`;
	};

	const MESSAGES: Partial<Record<string, string>> = {
		PopupBlocked: 'Your browser blocked the wallet window. Allow pop-ups for this site and try again.',
		UserClosed: 'The wallet window was closed before the move finished. Nothing was changed here.',
		UserRejected: 'You cancelled the move. Nothing was changed.',
		HomeNotEmpty: `${home} already has a wallet on this device, so nothing was moved. Keep using this one for now.`,
		Timeout: 'The wallet window did not answer in time. Nothing was changed here.'
	};

	function move() {
		error = '';
		let popup: WalletMigratePopup;
		try {
			// Synchronously in the click handler: browsers block popups after an await.
			popup = WalletMigratePopup.open({
				walletHomeOrigin: home,
				selfOrigin: location.origin,
				path: `${base}/migrate`,
				timeoutMs: HANDOFF_TIMEOUT_MS
			});
		} catch (e) {
			fail(e);
			return;
		}
		status = 'moving';
		void (async () => {
			try {
				const payload = await exportMoveBundle(browserMoveStorage, {
					from: location.origin,
					nodeDbName: getRuntimeConfig().db_name
				});
				const { digest_hex } = await popup.send(payload);
				markMovedTo({ home, at: Date.now(), digest_hex });
				relockAfterMove(encType);
				status = 'moved';
			} catch (e) {
				popup.close();
				fail(e);
			}
		})();
	}

	function fail(e: unknown) {
		status = 'failed';
		const code = e instanceof WalletMigrateError ? e.code : '';
		error = MESSAGES[code] ?? `The move failed (${e instanceof Error ? e.message : String(e)}). Nothing was changed here.`;
	}

	function useHere() {
		sessionStorage.setItem(MOVE_DEFER_KEY, 'true');
		location.replace(next());
	}

	const openHome = () => location.replace(`${home}${next()}`);

	onMount(() => {
		document.getElementById('app-loader')?.remove();
		const root = document.getElementById('app-root');
		if (root) root.style.opacity = '1';
	});
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4" data-testid="wallet-move" data-status={status}>
	{#if !hasWallet}
		<Card.Root>
			<Card.Header>
				<Card.Title>Your wallet lives at {home}</Card.Title>
				<Card.Description>There is no wallet stored on this site on this device.</Card.Description>
			</Card.Header>
			<Card.Footer><Button onclick={openHome}>Open the wallet</Button></Card.Footer>
		</Card.Root>
	{:else if status === 'moved'}
		<Card.Root data-testid="move-done">
			<Card.Header>
				<Card.Title>Your wallet now lives at {home}</Card.Title>
				<Card.Description>The copy on this site stays as it was; nothing was deleted.</Card.Description>
			</Card.Header>
			<Card.Footer><Button data-testid="move-open-home" onclick={openHome}>Open the wallet</Button></Card.Footer>
		</Card.Root>
	{:else if !unlocked}
		<LockScreen onUnlock={() => (unlocked = true)} />
	{:else}
		<Card.Root data-testid="move-offer">
			<Card.Header>
				<Card.Title>The wallet is moving to {home}</Card.Title>
				<Card.Description>
					Your wallet is stored in this browser for this site only. Moving copies it, on this device, into the wallet at
					<span class="font-mono">{home}</span>: a window opens there and asks you to confirm. Your recovery phrase is
					not sent over the network, and this site keeps its copy.
				</Card.Description>
			</Card.Header>
			{#if error}
				<Card.Content><p class="text-sm text-destructive" data-testid="move-error">{error}</p></Card.Content>
			{/if}
			<Card.Footer class="flex flex-wrap gap-2">
				<Button variant="outline" data-testid="move-defer" onclick={useHere}>Not now — use it here</Button>
				<Button data-testid="move-start" disabled={status === 'moving'} onclick={move}>
					{status === 'moving' ? 'Waiting for your confirmation…' : `Move to ${new URL(home).host}`}
				</Button>
			</Card.Footer>
		</Card.Root>
	{/if}
</main>
