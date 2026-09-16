<script lang="ts">
	/**
	 * Minimalist market-depth chart — pure SVG, theme-coloured, zero dependencies.
	 *
	 * Cumulative bid depth (Amethyst `--primary`) grows leftward from the mid;
	 * cumulative ask depth (muted slate `--muted-foreground`) grows rightward.
	 * A hairline marks the mid. No green/red, no gridlines — just the two walls
	 * of liquidity and the spread between them. Pure render of immutable arrays.
	 */
	interface Level {
		readonly price: number;
		readonly amount: number;
	}

	let {
		bids = [],
		asks = [],
		height = 120
	}: {
		/** Bids sorted price-descending (best first). */
		bids?: readonly Level[];
		/** Asks sorted price-ascending (best first). */
		asks?: readonly Level[];
		height?: number;
	} = $props();

	const W = 640;
	const PAD = { top: 8, bottom: 8 } as const;

	const view = $derived.by(() => {
		if (bids.length === 0 && asks.length === 0) return null;

		// Cumulative depth per side, best price nearest the mid.
		const cum = (levels: readonly Level[]) => {
			let total = 0;
			return levels.map((l) => {
				total += l.amount;
				return { price: l.price, depth: total };
			});
		};
		const cb = cum(bids);
		const ca = cum(asks);
		const maxDepth = Math.max(cb.at(-1)?.depth ?? 0, ca.at(-1)?.depth ?? 0, 1);

		const innerH = height - PAD.top - PAD.bottom;
		const mid = W / 2;
		const half = mid; // each side gets half the width
		const y = (d: number) => PAD.top + innerH * (1 - d / maxDepth);

		// Bid wall: from mid (best bid) leftward to the deepest level.
		const bidArea = () => {
			if (cb.length === 0) return '';
			const span = half - 8;
			const x = (i: number) => mid - span * (i / Math.max(1, cb.length - 1));
			let d = `M${mid},${y(0)}`;
			cb.forEach((p, i) => {
				d += ` L${x(i).toFixed(1)},${y(p.depth).toFixed(1)}`;
			});
			d += ` L${x(cb.length - 1).toFixed(1)},${(height - PAD.bottom).toFixed(1)} L${mid},${(height - PAD.bottom).toFixed(1)} Z`;
			return d;
		};
		// Ask wall: from mid (best ask) rightward.
		const askArea = () => {
			if (ca.length === 0) return '';
			const span = half - 8;
			const x = (i: number) => mid + span * (i / Math.max(1, ca.length - 1));
			let d = `M${mid},${y(0)}`;
			ca.forEach((p, i) => {
				d += ` L${x(i).toFixed(1)},${y(p.depth).toFixed(1)}`;
			});
			d += ` L${x(ca.length - 1).toFixed(1)},${(height - PAD.bottom).toFixed(1)} L${mid},${(height - PAD.bottom).toFixed(1)} Z`;
			return d;
		};

		return { bidArea: bidArea(), askArea: askArea(), mid };
	});
</script>

{#if view}
	<svg
		viewBox="0 0 {W} {height}"
		class="w-full select-none"
		style="height:{height}px"
		role="img"
		aria-label="Order-book depth"
		preserveAspectRatio="none">
		{#if view.bidArea}
			<path d={view.bidArea} fill="hsl(var(--primary))" opacity="0.16" />
			<path d={view.bidArea} fill="none" stroke="hsl(var(--primary))" stroke-width="1.5" opacity="0.8" />
		{/if}
		{#if view.askArea}
			<path d={view.askArea} fill="hsl(var(--muted-foreground))" opacity="0.12" />
			<path d={view.askArea} fill="none" stroke="hsl(var(--muted-foreground))" stroke-width="1.5" opacity="0.7" />
		{/if}
		<line x1={view.mid} x2={view.mid} y1={PAD.top} y2={height - PAD.bottom} stroke="hsl(var(--foreground))" stroke-width="1" stroke-dasharray="2 3" opacity="0.25" />
	</svg>
{:else}
	<div class="flex items-center justify-center text-[12px] text-muted-foreground" style="height:{height}px">
		No depth
	</div>
{/if}
