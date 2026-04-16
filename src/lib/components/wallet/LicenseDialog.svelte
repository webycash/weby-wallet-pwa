<script lang="ts">
	import { acceptLicense } from '$lib/stores/settings.svelte';

	let tosChecked = $state(false);

	const accept = () => {
		if (!tosChecked) return;
		acceptLicense();
		window.location.reload();
	};
</script>

<div class="container mx-auto px-4 py-8 max-w-lg">
	<div class="rounded-xl border border-border bg-card p-6 space-y-6">
		<div>
			<h2 class="text-xl font-bold text-primary mb-2">Terms of Service</h2>
			<p class="text-sm text-muted-foreground">
				To use Weby Wallet you must accept both the Webcash Terms of Service and the wallet MIT License.
			</p>
		</div>

		<!-- Webcash ToS -->
		<div class="rounded-lg border border-border bg-muted/30 p-4">
			<h3 class="text-sm font-semibold text-foreground mb-2">Webcash Terms of Service</h3>
			<p class="text-xs text-muted-foreground mb-3">
				Webcash is governed by the terms published at webcash.org. Please review them before proceeding.
			</p>
			<a
				href="https://webcash.org/terms"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 underline transition-colors"
			>
				Read Webcash Terms of Service
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-6H21m0 0v7.5m0-7.5l-9 9" />
				</svg>
			</a>
		</div>

		<!-- MIT License -->
		<div class="rounded-lg border border-border bg-muted/30 p-4">
			<h3 class="text-sm font-semibold text-foreground mb-2">Weby Wallet License (MIT)</h3>
			<pre class="text-xs text-muted-foreground overflow-auto max-h-40 whitespace-pre-wrap">MIT License

Copyright (c) 2026 Webycash

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</pre>
		</div>

		<!-- Checkbox + Accept -->
		<label class="flex items-start gap-3 cursor-pointer">
			<input
				type="checkbox"
				bind:checked={tosChecked}
				class="mt-0.5 h-4 w-4 rounded border-border accent-primary"
			/>
			<span class="text-sm text-foreground">
				I have read and accept the
				<a href="https://webcash.org/terms" target="_blank" rel="noopener noreferrer" class="text-primary underline">Webcash Terms of Service</a>
				and the Weby Wallet MIT License
			</span>
		</label>

		<button
			onclick={accept}
			disabled={!tosChecked}
			class="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors
				{tosChecked ? 'hover:bg-primary/90' : 'opacity-50 cursor-not-allowed'}"
		>
			Accept & Continue
		</button>
	</div>
</div>
