<script lang="ts">
	/** Trade — the selected market: a big header, the minimalist candle + depth
	 * charts, then the order book and the limit/market ticket. Charts are pure
	 * renders of immutable series; settlement handlers come from the parent. */
	import { orderbook, refreshBook, type Side, type MarketWalk, type Seeder } from '$lib/modules/webycash-exchange';
	import { pairLabel, assetLabel, mockCandles, lastPrice } from '$lib/modules/webycash-exchange/view-data';
	import CandleChart from './charts/CandleChart.svelte';
	import DepthChart from './charts/DepthChart.svelte';
	import OrderBook from './OrderBook.svelte';
	import OrderTicket from './OrderTicket.svelte';

	let {
		seeders,
		onLimit,
		onMarket,
		onPublish
	}: {
		seeders: Seeder[];
		onLimit: (a: { side: Side; price: number; amount: number; expiry: number }) => void;
		onMarket: (a: { side: Side; walk: MarketWalk }) => void;
		onPublish: (a: { side: Side; price: number; amount: number }) => void;
	} = $props();

	const candles = $derived(mockCandles(orderbook.pair, 48));
	const last = $derived(lastPrice(candles));
	const quote = $derived(assetLabel(orderbook.pair.quote));
</script>

<div class="space-y-5">
	<!-- Market header: pair · spread on the left, the last price as a calm focal point. -->
	<div class="flex items-end justify-between gap-4 px-0.5">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">{pairLabel(orderbook.pair)}</h2>
			<p class="text-[12px] text-muted-foreground tabular-nums mt-0.5">
				spread {orderbook.spread != null ? orderbook.spread.toFixed(2) : '—'} · {quote}
			</p>
		</div>
		<p class="text-4xl font-light tracking-tight tabular-nums text-primary leading-none">
			{last.toFixed(last < 1 ? 4 : 2)}
		</p>
	</div>

	<!-- Desktop: charts | order book | ticket, breathing across the full width.
	     Mobile: a single vertical column that scrolls. -->
	<div class="grid gap-5 items-start lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.05fr)]">
		<div class="space-y-5 min-w-0">
			<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4">
				<CandleChart {candles} maPeriod={7} label={quote} />
			</div>
			<div class="rounded-2xl bg-muted/20 ring-1 ring-border/40 p-4">
				<p class="text-[10px] tracking-[0.14em] uppercase text-muted-foreground mb-2">Depth</p>
				<DepthChart bids={orderbook.bids} asks={orderbook.asks} />
			</div>
		</div>

		<div class="min-w-0">
			<OrderBook
				pair={orderbook.pair}
				bids={orderbook.bids}
				asks={orderbook.asks}
				spread={orderbook.spread}
				midPrice={orderbook.midPrice}
				loading={orderbook.loading}
				error={orderbook.error}
				isEmpty={orderbook.isEmpty}
				lastUpdated={orderbook.lastUpdated}
				source={orderbook.source}
				onRefresh={() => refreshBook()} />
		</div>

		<div class="min-w-0">
			<OrderTicket
				pair={orderbook.pair}
				verdict={orderbook.verdict}
				{seeders}
				onPlaceLimit={onLimit}
				onPlaceMarket={onMarket}
				onPublish={onPublish} />
		</div>
	</div>
</div>
