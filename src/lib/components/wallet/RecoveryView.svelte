<script lang="ts">
	import { RotateCcw } from '@lucide/svelte';

	let { loading, onRecover }: {
		loading: boolean;
		onRecover: () => void;
	} = $props();
</script>

<div class="max-w-md mx-auto space-y-6 animate-fade-in">
	<div>
		<h2 class="text-[15px] font-semibold mb-2">Recover Wallet</h2>
		<p class="text-[14px] text-muted-foreground leading-relaxed">
			Scan the server for unspent outputs that belong to this wallet. Use this if you restored from a backup or suspect missing funds.
		</p>
	</div>

	<button
		class="w-full h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center gap-2.5 text-sm font-medium transition-all duration-200 active:scale-[0.97] hover:opacity-90 disabled:opacity-50"
		onclick={onRecover} disabled={loading}>
		<RotateCcw class="w-[16px] h-[16px]" />
		{loading ? 'Recovering...' : 'Recover Wallet'}
	</button>
</div>
