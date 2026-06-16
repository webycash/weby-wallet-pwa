<script lang="ts">
	/** Network — the extro layer made visible from the REAL recv-plane
	 * diagnostics attached to every DHTX FetchOrders poll (peers connected,
	 * channels open, orders recorded). No mocks: when nothing is connected the
	 * counts are honestly zero. */
	import { Users, Radio, Boxes, RefreshCw, Bell, BellOff } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { orderbook } from '$lib/modules/webycash-exchange';
	import {
		enablePush,
		disablePush,
		isPushEnabled,
		pushSupported
	} from '$lib/modules/webycash-exchange/push-subscribe';
	import { getExtroMode } from '$lib/extro';

	let { onRefresh }: { onRefresh: () => void } = $props();

	const peers = $derived(orderbook.diag?.peers_connected ?? 0);
	const channels = $derived(orderbook.diag?.channels_open ?? 0);
	const ordersSeen = $derived(orderbook.diag?.orders_recorded ?? 0);

	// Web Push (settlement notifications) — real OS notifications via the VAPID
	// dispatch Worker, so a closed wallet still surfaces a settled swap.
	const supported = pushSupported();
	let pushOn = $state(false);
	let pushBusy = $state(false);
	let pushNote = $state<string | null>(null);

	onMount(async () => {
		if (supported) pushOn = await isPushEnabled();
	});

	const togglePush = async () => {
		pushBusy = true;
		pushNote = null;
		try {
			if (pushOn) {
				await disablePush();
				pushOn = false;
				pushNote = 'Notifications off.';
			} else {
				const r = await enablePush();
				if (r.ok) {
					pushOn = true;
					pushNote = 'Notifications on — settled swaps will alert you.';
				} else {
					pushNote =
						r.reason === 'denied'
							? 'Permission denied in the browser.'
							: r.reason === 'unsupported'
								? 'This browser does not support push.'
								: `Could not enable (${r.reason}${r.detail ? `: ${r.detail}` : ''}).`;
				}
			}
		} finally {
			pushBusy = false;
		}
	};
</script>

<div class="space-y-4">
	<h2 class="text-xl font-semibold tracking-tight px-0.5">Network</h2>

	<div class="grid grid-cols-3 gap-3">
		<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4 text-center">
			<Users class="w-5 h-5 mx-auto mb-1 text-primary" />
			<p class="text-2xl font-normal tabular-nums">{peers}</p>
			<p class="text-[11px] text-muted-foreground">Peers</p>
		</div>
		<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4 text-center">
			<Radio class="w-5 h-5 mx-auto mb-1 text-primary" />
			<p class="text-2xl font-normal tabular-nums">{channels}</p>
			<p class="text-[11px] text-muted-foreground">Channels</p>
		</div>
		<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4 text-center">
			<Boxes class="w-5 h-5 mx-auto mb-1 text-primary" />
			<p class="text-2xl font-normal tabular-nums">{ordersSeen}</p>
			<p class="text-[11px] text-muted-foreground">Orders seen</p>
		</div>
	</div>

	<p class="text-[12px] text-muted-foreground px-1 leading-relaxed">
		Extro is a <span class="text-foreground font-medium">peer-and-agent</span> network: humans and autonomous
		agents trade as equals — peer↔peer, agent↔agent, peer↔agent. The counts above are live from the order-book
		recv plane on your node.
	</p>

	<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4 space-y-3">
		<div class="flex items-center justify-between">
			<span class="text-[13px]">Order book source</span>
			<span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground"
				>{orderbook.source} · {getExtroMode()} node</span>
		</div>
		<button
			onclick={onRefresh}
			class="w-full h-11 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-[14px] font-medium active:scale-[0.97] transition-all duration-200">
			<RefreshCw class="w-4 h-4" />
			Fetch order book
		</button>
	</div>

	{#if supported}
		<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4 space-y-3">
			<div class="flex items-center justify-between">
				<span class="text-[13px] flex items-center gap-2">
					{#if pushOn}
						<Bell class="w-4 h-4 text-primary" />
					{:else}
						<BellOff class="w-4 h-4 text-muted-foreground" />
					{/if}
					Settlement notifications
				</span>
				<span
					class="text-[11px] px-2 py-0.5 rounded-full {pushOn
						? 'bg-primary/10 text-primary'
						: 'bg-muted/50 text-muted-foreground'}">{pushOn ? 'On' : 'Off'}</span>
			</div>
			<button
				onclick={togglePush}
				disabled={pushBusy}
				class="w-full h-11 rounded-full bg-muted/50 hover:bg-muted/80 flex items-center justify-center gap-2 text-[14px] font-medium active:scale-[0.97] transition-all duration-200 disabled:opacity-50">
				{#if pushOn}
					<BellOff class="w-4 h-4" /> Turn off
				{:else}
					<Bell class="w-4 h-4" /> Enable notifications
				{/if}
			</button>
			{#if pushNote}
				<p class="text-[11px] text-muted-foreground px-1 leading-relaxed">{pushNote}</p>
			{/if}
			<p class="text-[11px] text-muted-foreground/70 px-1 leading-relaxed">
				A real OS notification when a swap settles — even with the wallet closed. Nothing secret
				leaves the device; a subscription is just a delivery address.
			</p>
		</div>
	{/if}

	<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4">
		<p class="text-[13px] leading-relaxed">
			Publishing pays the seeders that relay your order <span class="font-medium">0.1%</span> of its value,
			split equally.
			{#if peers === 0}
				<span class="text-warning">No peers connected yet — an order publishes once peers relay it.</span>
			{/if}
		</p>
	</div>
</div>
