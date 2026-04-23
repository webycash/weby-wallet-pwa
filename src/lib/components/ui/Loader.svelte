<script lang="ts">
	let { size = 'default' }: { size?: 'default' | 'sm' } = $props();
</script>

<div class={size === 'sm' ? 'loader-sm' : 'loader'}>
	<svg viewBox="0 0 50 50" fill="none">
		<defs>
			<linearGradient id="loader-grad" gradientUnits="userSpaceOnUse" x1="4" y1="25" x2="46" y2="25">
				<stop offset="0%" stop-color="hsl(var(--primary))" stop-opacity="0"/>
				<stop offset="100%" stop-color="hsl(var(--primary))" stop-opacity="1"/>
			</linearGradient>
		</defs>
		<path d="M4 25 A21 21 0 0 1 46 25" stroke="url(#loader-grad)" stroke-width="3.5" stroke-linecap="round"/>
	</svg>
</div>
