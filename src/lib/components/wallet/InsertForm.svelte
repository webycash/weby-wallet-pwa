<script lang="ts">
	import { ArrowDownToLine, ClipboardPaste, ScanLine, X } from '@lucide/svelte';
	let { onSubmit, disabled }: { onSubmit: (s: string) => void; disabled: boolean } = $props();
	let input = $state('');
	let scanning = $state(false);
	let scanStatus = $state('');
	let videoEl = $state<HTMLVideoElement>();
	let canvasEl = $state<HTMLCanvasElement>();
	let cameraStream: MediaStream | null = null;
	let scanTimer: ReturnType<typeof setInterval> | null = null;

	const submit = () => {
		if (input.trim()) { onSubmit(input.trim()); input = ''; }
	};

	const paste = async () => {
		try {
			const text = await navigator.clipboard.readText();
			const webcash = extractWebcash(text.trim());
			if (webcash) { onSubmit(webcash); input = ''; }
			else if (text.trim()) input = text.trim();
		} catch {}
	};

	const extractWebcash = (raw: string): string | null => {
		// Direct webcash string
		if (raw.includes(':secret:')) return raw;
		// Wallet URL with ?webcash= param
		try {
			const url = new URL(raw);
			const wc = url.searchParams.get('webcash');
			if (wc) return wc;
		} catch {}
		// Starts with 'e' (webcash format)
		if (/^e\d/.test(raw)) return raw;
		return null;
	};

	const startScan = async () => {
		scanning = true;
		scanStatus = 'Starting camera...';
		try {
			cameraStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment', width: { ideal: 480 }, height: { ideal: 480 } }
			});
			if (videoEl) {
				videoEl.srcObject = cameraStream;
				await videoEl.play();
			}
			scanStatus = 'Point camera at QR code';
			const jsQR = (await import('jsqr')).default;
			scanTimer = setInterval(() => {
				if (!cameraStream || !videoEl || !canvasEl || videoEl.readyState < 2) return;
				const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
				if (!ctx) return;
				const w = videoEl.videoWidth;
				const h = videoEl.videoHeight;
				if (w === 0 || h === 0) return;
				canvasEl.width = w;
				canvasEl.height = h;
				ctx.drawImage(videoEl, 0, 0, w, h);
				const imageData = ctx.getImageData(0, 0, w, h);
				const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
				if (code?.data) {
					const value = code.data.trim();
					const webcash = extractWebcash(value);
					if (webcash) {
						stopScan();
						onSubmit(webcash);
					}
				}
			}, 250);
		} catch {
			scanStatus = 'Camera not available';
			setTimeout(() => { scanning = false; }, 1500);
		}
	};

	const stopScan = () => {
		if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
		cameraStream?.getTracks().forEach(t => t.stop());
		cameraStream = null;
		scanning = false;
	};
</script>

<div class="rounded-2xl border border-border bg-card p-5">
	<label class="text-xs font-medium text-muted-foreground" for="insert-input">Paste webcash to insert</label>
	<div class="relative mt-2">
		<textarea
			id="insert-input"
			bind:value={input}
			placeholder="e0.001:secret:abc123..."
			class="w-full rounded-xl border border-input bg-background px-4 py-3 pr-20 text-base font-mono h-20 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
			spellcheck="false"
		></textarea>
		<button onclick={paste}
			class="absolute top-2 right-2 flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all">
			<ClipboardPaste class="w-3.5 h-3.5" /> Paste
		</button>
	</div>

	<div class="grid grid-cols-2 gap-2 mt-3">
		<button onclick={startScan}
			class="flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-all">
			<ScanLine class="w-4 h-4" /> Scan QR
		</button>
		<button onclick={submit}
			class="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all
				{disabled ? 'opacity-50 pointer-events-none animate-pulse' : 'hover:opacity-90'}"
			disabled={disabled || !input.trim()}>
			<ArrowDownToLine class="w-4 h-4" />
			{disabled ? 'Inserting...' : 'Insert'}
		</button>
	</div>
</div>

{#if scanning}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onclick={stopScan}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-card rounded-2xl p-6 mx-4 max-w-sm w-full space-y-4 fade-in" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold text-foreground">Scan QR Code</h3>
				<button onclick={stopScan} class="text-muted-foreground hover:text-foreground transition-all">
					<X class="w-4 h-4" />
				</button>
			</div>
			<div class="rounded-2xl overflow-hidden bg-black aspect-square relative">
				<video bind:this={videoEl} autoplay playsinline muted class="w-full h-full object-cover"></video>
				<canvas bind:this={canvasEl} class="hidden"></canvas>
				<div class="absolute inset-0 pointer-events-none">
					<div class="absolute inset-[12%] border border-primary rounded-2xl"></div>
					<div class="absolute inset-[12%] border border-primary rounded-2xl animate-pulse"></div>
				</div>
				<div class="absolute bottom-3 left-0 right-0 text-center">
					<span class="text-xs text-white bg-black backdrop-blur-sm px-3 py-1.5 rounded-full">{scanStatus}</span>
				</div>
			</div>
		</div>
	</div>
{/if}
