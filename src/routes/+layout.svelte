<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		const loader = document.getElementById('app-loader');
		if (loader) {
			loader.classList.add('fade-out');
			setTimeout(() => loader.remove(), 300);
		}
	});
</script>

{@render children()}
