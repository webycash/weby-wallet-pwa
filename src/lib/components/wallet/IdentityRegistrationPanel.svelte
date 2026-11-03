<script lang="ts">
	// Register this wallet's Extro identity with the keyserver, paying the
	// keyserver's published fee from the webcash balance (see
	// $lib/extro/registration). The fee shown is read from the keyserver's
	// signed challenge before anything is paid.
	import { onMount } from 'svelte';
	import { getExtroClient } from '$lib/extro';
	import { getSelfIdentity } from '$lib/extro/self-identity';
	import {
		PriceChangedError,
		isIdentityRegistered,
		quoteRegistrationFee,
		registerExtroIdentity,
		type RegistrationQuote
	} from '$lib/extro/registration';

	let { onBalanceUpdate }: { onBalanceUpdate: () => void } = $props();

	let fingerprint = $state('');
	let registered = $state<boolean | null>(null);
	let nickname = $state('');
	let busy = $state(false);
	let message = $state('');
	let fee = $state<RegistrationQuote | null>(null);
	let feeError = $state('');

	async function loadFee() {
		feeError = '';
		try {
			fee = await quoteRegistrationFee();
		} catch (e) {
			fee = null;
			feeError = String(e instanceof Error ? e.message : e);
		}
	}

	async function refresh() {
		try {
			const self = await getSelfIdentity(getExtroClient(), 0);
			fingerprint = self.fingerprintHex;
			registered = isIdentityRegistered(fingerprint);
			if (registered === false) await loadFee();
		} catch (e) {
			message = String(e instanceof Error ? e.message : e);
		}
	}

	onMount(refresh);

	async function register() {
		if (!fee) return;
		busy = true;
		message = '';
		try {
			const r = await registerExtroIdentity(nickname.trim(), fee.amount);
			registered = true;
			message = `Registered ${r.nickname} (${r.fingerprint_hex.slice(0, 8)}…)`;
		} catch (e) {
			if (e instanceof PriceChangedError) fee = e.quote;
			message = String(e instanceof Error ? e.message : e);
		} finally {
			busy = false;
			onBalanceUpdate();
		}
	}
</script>

<div class="mt-4 rounded-xl border border-border p-4" data-testid="identity-registration">
	<h3 class="text-sm font-semibold">Extro identity</h3>
	{#if fingerprint}
		<p class="text-muted-foreground mt-1 break-all font-mono text-xs" data-testid="identity-fingerprint">{fingerprint}</p>
	{/if}
	{#if registered === true}
		<p class="mt-2 text-sm" data-testid="identity-registered">Registered with the keyserver.</p>
	{:else if registered === false}
		{#if fee}
			<p class="text-muted-foreground mt-2 text-xs" data-testid="identity-fee">
				Registration fee: {fee.amount} webcash (set by the keyserver, paid from this wallet).
			</p>
		{:else if feeError}
			<p class="mt-2 text-xs" data-testid="identity-fee-error">
				Could not read the keyserver's registration fee: {feeError}
				<button class="underline" onclick={loadFee} data-testid="identity-fee-retry">Retry</button>
			</p>
		{:else}
			<p class="text-muted-foreground mt-2 text-xs" data-testid="identity-fee-loading">Reading the keyserver's registration fee…</p>
		{/if}
		<div class="mt-2 flex gap-2">
			<input
				class="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
				placeholder="nickname"
				bind:value={nickname}
				data-testid="identity-nickname"
			/>
			<button
				class="rounded-md border border-border px-3 py-1 text-sm"
				disabled={busy || !fee || nickname.trim().length === 0}
				onclick={register}
				data-testid="identity-register"
				>{busy ? 'Registering…' : fee ? `Register (pay ${fee.amount} webcash)` : 'Register'}</button
			>
		</div>
	{/if}
	{#if message}
		<p class="mt-2 text-xs" data-testid="identity-message">{message}</p>
	{/if}
</div>
