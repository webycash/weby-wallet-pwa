<script lang="ts">
	import { acceptLicense } from '$lib/stores/settings.svelte';

	const LICENSE_TEXT = `MIT License

Copyright (c) 2026 Webycash

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

	const accept = () => {
		acceptLicense();
		window.location.reload();
	};
</script>

<div class="container mx-auto px-4 py-12 max-w-lg">
	<div class="rounded-xl border border-border bg-card p-6">
		<h2 class="text-xl font-bold text-primary mb-4">License Agreement</h2>
		<p class="text-sm text-muted-foreground mb-4">
			Please read and accept the MIT License to use Weby Wallet.
		</p>
		<pre class="text-xs text-muted-foreground bg-muted/50 rounded-lg p-4 overflow-auto max-h-64 mb-6 whitespace-pre-wrap">{LICENSE_TEXT}</pre>
		<button
			onclick={accept}
			class="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
		>
			I Accept
		</button>
	</div>
</div>
