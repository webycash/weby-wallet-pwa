<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="container mx-auto px-6 py-16 text-center max-w-md">
	<h1 class="text-4xl font-bold text-primary mb-4">{page.status}</h1>
	<p class="text-muted-foreground">{page.error?.message ?? 'Something went wrong'}</p>
	<a href="/" class="mt-6 inline-block text-sm text-primary underline hover:no-underline">Back to wallet</a>
</div>
