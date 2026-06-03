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

<div class="space-y-4">
	<div class="flex items-end justify-between px-1">
		<div>
			<h2 class="text-[17px] font-semibold">{pairLabel(orderbook.pair)}</h2>
			<p class="text-[12px] text-muted-foreground tabular-nums">
				spread {orderbook.spread != null ? orderbook.spread.toFixed(2) : '—'}
			</p>
		</div>
		<p class="text-3xl font-normal tracking-tight tabular-nums">{last.toFixed(last < 1 ? 4 : 2)}</p>
	</div>

	<div class="rounded-2xl bg-muted/20 p-3">
		<CandleChart {candles} maPeriod={7} label={quote} />
	</div>

	<div class="rounded-2xl bg-muted/20 p-3">
		<p class="text-[10px] tracking-wide uppercase text-muted-foreground mb-1 px-1">Depth</p>
		<DepthChart bids={orderbook.bids} asks={orderbook.asks} />
	</div>

	<div class="grid gap-4 md:grid-cols-2">
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

		<OrderTicket
			pair={orderbook.pair}
			verdict={orderbook.verdict}
			{seeders}
			onPlaceLimit={onLimit}
			onPlaceMarket={onMarket}
			onPublish={onPublish} />
	</div>
</div>
