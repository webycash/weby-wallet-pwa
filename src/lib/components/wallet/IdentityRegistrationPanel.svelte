<script lang="ts">
	// Register this wallet's Extro identity with the keyserver, paying the
	// fee from the webcash balance (see $lib/extro/registration).
	import { onMount } from 'svelte';
	import { getExtroClient } from '$lib/extro';
	import { getSelfIdentity } from '$lib/extro/self-identity';
	import {
		REGISTRATION_FEE,
		isIdentityRegistered,
		registerExtroIdentity
	} from '$lib/extro/registration';

	let { onBalanceUpdate }: { onBalanceUpdate: () => void } = $props();

	let fingerprint = $state('');
	let registered = $state<boolean | null>(null);
	let nickname = $state('');
	let busy = $state(false);
	let message = $state('');

	async function refresh() {
		try {
			const self = await getSelfIdentity(getExtroClient(), 0);
			fingerprint = self.fingerprintHex;
			registered = isIdentityRegistered(fingerprint);
		} catch (e) {
			message = String(e instanceof Error ? e.message : e);
		}
	}

	onMount(refresh);

	async function register() {
		busy = true;
		message = '';
		try {
			const r = await registerExtroIdentity(nickname.trim());
			registered = true;
			message = `Registered ${r.nickname} (${r.fingerprint_hex.slice(0, 8)}…)`;
		} catch (e) {
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
		<p class="text-muted-foreground mt-2 text-xs">Registration fee: {REGISTRATION_FEE} webcash.</p>
		<div class="mt-2 flex gap-2">
			<input
				class="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
				placeholder="nickname"
				bind:value={nickname}
				data-testid="identity-nickname"
			/>
			<button
				class="rounded-md border border-border px-3 py-1 text-sm"
				disabled={busy || nickname.trim().length === 0}
				onclick={register}
				data-testid="identity-register">{busy ? 'Registering…' : 'Register'}</button
			>
		</div>
	{/if}
	{#if message}
		<p class="mt-2 text-xs" data-testid="identity-message">{message}</p>
	{/if}
</div>
