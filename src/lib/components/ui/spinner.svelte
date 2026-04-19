<script lang="ts">
	let { size = 'md', class: className = '' }: { size?: 'sm' | 'md' | 'lg'; class?: string } = $props();
	const sizes = { sm: 'w-4 h-4 border-[1.5px]', md: 'w-5 h-5 border-2', lg: 'w-7 h-7 border-2' };
</script>

<div class="inline-flex items-center justify-center {className}" role="status" aria-label="Loading">
	<div class="{sizes[size]} border-current/20 border-t-current rounded-full animate-spin"></div>
</div>
