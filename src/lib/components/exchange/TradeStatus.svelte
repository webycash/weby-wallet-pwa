<script lang="ts">
	import type { TradePhase } from '$lib/modules/webycash-exchange';

	let { phase }: { phase: TradePhase } = $props();

	const meta: Record<TradePhase, { label: string; cls: string }> = {
		'order-selected': { label: 'Selected', cls: 'bg-muted/50 text-muted-foreground' },
		'request-sent': { label: 'Requested', cls: 'bg-primary/10 text-primary' },
		'maker-response': { label: 'Maker replied', cls: 'bg-primary/10 text-primary' },
		'proof-precheck': { label: 'Proof check', cls: 'bg-primary/10 text-primary' },
		'delivery-dispatched': { label: 'Delivering', cls: 'bg-warning/15 text-warning' },
		'post-check': { label: 'Post-check', cls: 'bg-warning/15 text-warning' },
		'ark-release': { label: 'ARK release', cls: 'bg-warning/15 text-warning' },
		settled: { label: 'Settled', cls: 'bg-success/15 text-success' },
		refunded: { label: 'Refunded', cls: 'bg-muted/60 text-foreground' },
		failed: { label: 'Failed', cls: 'bg-destructive/15 text-destructive' },
		canceled: { label: 'Canceled', cls: 'bg-muted/50 text-muted-foreground' }
	};
	const m = $derived(meta[phase]);
</script>

<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap {m.cls}">
	{m.label}
</span>
