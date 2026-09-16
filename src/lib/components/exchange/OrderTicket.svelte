<script lang="ts">
	import {
		assetLabel,
		walkCurrent,
		type MarketWalk,
		type Seeder,
		type Side,
		type TradingPair
	} from '$lib/modules/webycash-exchange';
	import type { PairVerdict } from '$lib/modules/webycash-exchange';
	import PublishFeePreview from './PublishFeePreview.svelte';

	let {
		pair,
		verdict,
		seeders,
		onPlaceLimit,
		onPlaceMarket,
		onPublish
	}: {
		pair: TradingPair;
		verdict: PairVerdict;
		seeders: Seeder[];
		onPlaceLimit: (args: { side: Side; price: number; amount: number; expiry: number }) => void;
		onPlaceMarket: (args: { side: Side; walk: MarketWalk }) => void;
		onPublish: (args: { side: Side; price: number; amount: number }) => void;
	} = $props();

	type Mode = 'limit' | 'market';
	let mode = $state<Mode>('limit');
	let side = $state<Side>('buy');
	let priceStr = $state('');
	let amountStr = $state('');
	let expiryMin = $state(60);
	let slippagePct = $state(1);
	let capStr = $state('');

	const price = $derived(parseFloat(priceStr) || 0);
	const amount = $derived(parseFloat(amountStr) || 0);
	const cap = $derived(capStr.trim() === '' ? undefined : parseFloat(capStr) || 0);

	// Live market-order walk preview (pure delegation to the store/book-math).
	const walk = $derived<MarketWalk | null>(
		mode === 'market' && amount > 0
			? walkCurrent({
					side,
					requestedAmount: amount,
					slippage: slippagePct / 100,
					quoteCap: cap
				})
			: null
	);

	const blocked = $derived(!verdict.allowed);
	const canLimit = $derived(!blocked && price > 0 && amount > 0);
	const canMarket = $derived(!blocked && !!walk && walk.fills.length > 0);
	// Order value (in quote units) drives the publication-fee preview.
	const orderValue = $derived(Math.round(price * amount));

	const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

	const stopLabel: Record<MarketWalk['stop'], string> = {
		filled: 'Fully filled',
		'book-exhausted': 'Partial — book exhausted',
		slippage: 'Stopped at slippage limit',
		cap: 'Stopped at quote cap'
	};

	const submitLimit = () => {
		if (!canLimit) return;
		onPlaceLimit({ side, price, amount, expiry: Math.floor(Date.now() / 1000) + expiryMin * 60 });
	};
	const submitMarket = () => {
		if (!canMarket || !walk) return;
		onPlaceMarket({ side, walk });
	};
	const submitPublish = () => {
		if (!canLimit) return;
		onPublish({ side, price, amount });
	};
</script>

<div class="rounded-2xl bg-muted/20 p-4 space-y-3">
	<!-- Mode + side toggles -->
	<div class="flex gap-2">
		<div class="flex rounded-full bg-muted/40 p-0.5 text-[12px] font-medium">
			<button
				onclick={() => (mode = 'limit')}
				class="px-3 py-1.5 rounded-full transition-all {mode === 'limit' ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
				>Limit</button>
			<button
				onclick={() => (mode = 'market')}
				class="px-3 py-1.5 rounded-full transition-all {mode === 'market' ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
				>Market</button>
		</div>
		<div class="flex rounded-full bg-muted/40 p-0.5 text-[12px] font-medium ml-auto">
			<button
				onclick={() => (side = 'buy')}
				class="px-3 py-1.5 rounded-full transition-all {side === 'buy' ? 'bg-success text-success-foreground' : 'text-muted-foreground'}"
				>Buy</button>
			<button
				onclick={() => (side = 'sell')}
				class="px-3 py-1.5 rounded-full transition-all {side === 'sell' ? 'bg-destructive text-destructive-foreground' : 'text-muted-foreground'}"
				>Sell</button>
		</div>
	</div>

	<!-- Blocked-pair warning -->
	{#if blocked}
		<div class="rounded-xl bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive">
			<strong class="font-semibold">Pair blocked.</strong>
			{verdict.label}
		</div>
	{:else if verdict.bearerRaceRisk}
		<!-- Race-bounded flows MUST be visibly labeled before confirmation. -->
		<div class="rounded-xl bg-warning/10 px-3 py-2.5 text-[12px] text-warning">
			<strong class="font-semibold">Non-atomic, referee-mediated.</strong>
			{verdict.label}
		</div>
	{/if}

	<fieldset disabled={blocked} class="space-y-3 {blocked ? 'opacity-50 pointer-events-none' : ''}">
		<!-- Amount (always) -->
		<label class="block">
			<span class="text-[11px] text-muted-foreground">Amount ({assetLabel(pair.base)})</span>
			<input
				bind:value={amountStr}
				type="number"
				inputmode="decimal"
				placeholder="0.00"
				class="w-full mt-1 h-11 rounded-xl bg-background px-3 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
		</label>

		{#if mode === 'limit'}
			<!-- Price + expiry -->
			<label class="block">
				<span class="text-[11px] text-muted-foreground">Price ({assetLabel(pair.quote)} per {assetLabel(pair.base)})</span>
				<input
					bind:value={priceStr}
					type="number"
					inputmode="decimal"
					placeholder="0.00"
					class="w-full mt-1 h-11 rounded-xl bg-background px-3 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
			</label>
			<label class="block">
				<span class="text-[11px] text-muted-foreground">Expiry (minutes)</span>
				<input
					bind:value={expiryMin}
					type="number"
					min="1"
					class="w-full mt-1 h-11 rounded-xl bg-background px-3 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
			</label>
			{#if orderValue > 0}
				<PublishFeePreview {orderValue} {seeders} />
			{/if}
			<div class="grid grid-cols-2 gap-2">
				<button
					onclick={submitLimit}
					disabled={!canLimit}
					class="h-11 rounded-full bg-primary text-primary-foreground text-[13px] font-medium transition-all active:scale-[0.97] hover:opacity-90 disabled:opacity-40">
					Place {side} limit
				</button>
				<button
					onclick={submitPublish}
					disabled={!canLimit}
					class="h-11 rounded-full bg-muted/60 text-foreground text-[13px] font-medium transition-all active:scale-[0.97] hover:bg-muted/80 disabled:opacity-40">
					Publish order
				</button>
			</div>
		{:else}
			<!-- Market: slippage + cap -->
			<div class="grid grid-cols-2 gap-2">
				<label class="block">
					<span class="text-[11px] text-muted-foreground">Max slippage (%)</span>
					<input
						bind:value={slippagePct}
						type="number"
						min="0"
						step="0.1"
						class="w-full mt-1 h-11 rounded-xl bg-background px-3 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
				</label>
				<label class="block">
					<span class="text-[11px] text-muted-foreground">Quote cap (opt.)</span>
					<input
						bind:value={capStr}
						type="number"
						inputmode="decimal"
						placeholder="none"
						class="w-full mt-1 h-11 rounded-xl bg-background px-3 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
				</label>
			</div>

			<!-- Walk preview: partial fills + remaining -->
			{#if walk}
				<div class="rounded-xl bg-background/60 px-3 py-2.5 space-y-1.5 text-[12px]">
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">{stopLabel[walk.stop]}</span>
						<span class="text-[10px] px-2 py-0.5 rounded-full
							{walk.stop === 'filled' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}">
							{walk.fills.length} fill{walk.fills.length === 1 ? '' : 's'}
						</span>
					</div>
					<div class="flex justify-between tabular-nums">
						<span class="text-muted-foreground">Filled</span>
						<span>{fmt(walk.filledAmount)} / {fmt(amount)}</span>
					</div>
					{#if walk.remainingAmount > 0}
						<div class="flex justify-between tabular-nums text-warning">
							<span>Remaining</span>
							<span>{fmt(walk.remainingAmount)}</span>
						</div>
					{/if}
					<div class="flex justify-between tabular-nums">
						<span class="text-muted-foreground">Est. {side === 'buy' ? 'cost' : 'proceeds'}</span>
						<span>{fmt(walk.totalQuote)} {assetLabel(pair.quote)}</span>
					</div>
				</div>
			{:else}
				<p class="text-[11px] text-muted-foreground px-1">Enter an amount to preview the book walk.</p>
			{/if}

			<button
				onclick={submitMarket}
				disabled={!canMarket}
				class="w-full h-11 rounded-full bg-primary text-primary-foreground text-[13px] font-medium transition-all active:scale-[0.97] hover:opacity-90 disabled:opacity-40">
				Execute {side} market
			</button>
		{/if}
	</fieldset>
</div>
