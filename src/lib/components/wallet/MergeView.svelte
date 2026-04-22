<script lang="ts">
	import { Merge } from '@lucide/svelte';

	let { loading, onMerge }: {
		loading: boolean;
		onMerge: () => void;
	} = $props();
</script>

<div class="max-w-md mx-auto space-y-6 animate-fade-in">
	<div>
		<h2 class="text-[15px] font-semibold mb-2">Merge Outputs</h2>
		<p class="text-[13px] text-muted-foreground leading-relaxed">
			Combine multiple small webcash outputs into fewer larger ones. This reduces wallet size and improves performance.
		</p>
	</div>

	<button
		class="w-full h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center gap-2.5 text-sm font-medium transition-all duration-200 active:scale-[0.97] hover:opacity-90 disabled:opacity-50"
		onclick={onMerge} disabled={loading}>
		<Merge class="w-[16px] h-[16px]" />
		{loading ? 'Merging...' : 'Merge Outputs'}
	</button>
</div>
