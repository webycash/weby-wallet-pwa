<script lang="ts">
	import '../app.css';
	import { version } from '$app/environment';

	let { children } = $props();
</script>

{@render children()}

<footer class="fixed bottom-2 right-3 text-[10px] text-muted-foreground/50 pointer-events-none select-none">
	v{version}
</footer>
