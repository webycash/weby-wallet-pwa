<script lang="ts">
	/**
	 * Minimalist candlestick chart — pure SVG, theme-coloured, zero dependencies.
	 *
	 * Direction is read by brand-vs-neutral, NOT by alarm colours: an up candle
	 * uses the brand (Amethyst `--primary`), a down candle a muted slate
	 * (`--muted-foreground`). No green/red. No gridlines, no oscillators — the
	 * simplest honest read of a price series, plus one optional moving average.
	 *
	 * Pure render: given an immutable `candles` series it draws; it owns no state
	 * and fetches nothing. The series comes from the orderbook store (observed
	 * trades from the extro torrent; mock until that lands).
	 */
	export interface Candle {
		/** unix seconds (bucket start) */
		readonly t: number;
		readonly o: number;
		readonly h: number;
		readonly l: number;
		readonly c: number;
	}

	let {
		candles = [],
		maPeriod = 0,
		height = 220,
		label = ''
	}: {
		candles?: readonly Candle[];
		/** 0 disables the moving-average line. */
		maPeriod?: number;
		height?: number;
		/** quote-asset label for the price axis, e.g. "Webcash". */
		label?: string;
	} = $props();

	// Fixed viewBox width; the SVG scales responsively to its container.
	const W = 640;
	const PAD = { top: 12, right: 10, bottom: 16, left: 10 } as const;

	const view = $derived.by(() => {
		const n = candles.length;
		if (n === 0) return null;
		let lo = Infinity;
		let hi = -Infinity;
		for (const k of candles) {
			if (k.l < lo) lo = k.l;
			if (k.h > hi) hi = k.h;
		}
		if (!(hi > lo)) {
			// Flat series — pad so the single level renders mid-frame.
			const m = hi || 1;
			lo = m * 0.999;
			hi = m * 1.001;
		}
		const innerW = W - PAD.left - PAD.right;
		const innerH = height - PAD.top - PAD.bottom;
		const slot = innerW / n;
		const bodyW = Math.max(1, slot * 0.62);
		const x = (i: number) => PAD.left + slot * (i + 0.5);
		const y = (v: number) => PAD.top + innerH * (1 - (v - lo) / (hi - lo));

		const bars = candles.map((k, i) => {
			const up = k.c >= k.o;
			const yo = y(k.o);
			const yc = y(k.c);
			return {
				up,
				cx: x(i),
				wickTop: y(k.h),
				wickBottom: y(k.l),
				bodyY: Math.min(yo, yc),
				bodyH: Math.max(1, Math.abs(yo - yc)),
				bodyW
			};
		});

		// Simple moving average of closes, as a thin polyline.
		let maPath = '';
		if (maPeriod > 1 && n >= maPeriod) {
			const pts: string[] = [];
			for (let i = maPeriod - 1; i < n; i++) {
				let sum = 0;
				for (let j = i - maPeriod + 1; j <= i; j++) sum += candles[j].c;
				pts.push(`${x(i).toFixed(1)},${y(sum / maPeriod).toFixed(1)}`);
			}
			maPath = `M${pts.join(' L')}`;
		}

		const last = candles[n - 1];
		return { bars, maPath, lastY: y(last.c), last: last.c, hi, lo };
	});

	const fmt = (v: number) =>
		v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2);
</script>

{#if view}
	<svg
		viewBox="0 0 {W} {height}"
		class="w-full select-none"
		style="height:{height}px"
		role="img"
		aria-label="Price chart{label ? ` in ${label}` : ''}"
		preserveAspectRatio="none">
		<!-- last-price guide: a hairline at the latest close -->
		<line
			x1={PAD.left}
			x2={W - PAD.right}
			y1={view.lastY}
			y2={view.lastY}
			stroke="hsl(var(--muted-foreground))"
			stroke-width="1"
			stroke-dasharray="2 4"
			opacity="0.35" />

		{#each view.bars as b}
			{@const color = b.up ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
			<line x1={b.cx} x2={b.cx} y1={b.wickTop} y2={b.wickBottom} stroke={color} stroke-width="1" opacity={b.up ? 0.9 : 0.7} />
			<rect
				x={b.cx - b.bodyW / 2}
				y={b.bodyY}
				width={b.bodyW}
				height={b.bodyH}
				rx="1"
				fill={color}
				opacity={b.up ? 0.95 : 0.65} />
		{/each}

		{#if view.maPath}
			<path d={view.maPath} fill="none" stroke="hsl(var(--accent-foreground))" stroke-width="1.5" opacity="0.7" />
		{/if}
	</svg>

	<div class="flex justify-between px-1 pt-1 text-[10px] tabular-nums text-muted-foreground">
		<span>{fmt(view.lo)}</span>
		<span class="font-medium text-foreground">{fmt(view.last)}{label ? ` ${label}` : ''}</span>
		<span>{fmt(view.hi)}</span>
	</div>
{:else}
	<div class="flex items-center justify-center text-[12px] text-muted-foreground" style="height:{height}px">
		No trades observed yet
	</div>
{/if}
