<script lang="ts">
	import { ClipboardPaste, ScanLine, X } from '@lucide/svelte';
	let { onSubmit, disabled }: { onSubmit: (s: string) => void; disabled: boolean } = $props();
	let input = $state('');
	let scanning = $state(false);
	let scanStatus = $state('');
	let videoEl = $state<HTMLVideoElement>();
	let canvasEl = $state<HTMLCanvasElement>();
	let cameraStream: MediaStream | null = null;
	let scanTimer: ReturnType<typeof setInterval> | null = null;

	const extractWebcash = (raw: string): string | null => {
		if (raw.includes(':secret:')) return raw;
		try {
			const url = new URL(raw);
			const wc = url.searchParams.get('webcash');
			if (wc) return wc;
		} catch {}
		if (/^e\d/.test(raw)) return raw;
		return null;
	};

	const paste = async () => {
		try {
			const text = await navigator.clipboard.readText();
			const webcash = extractWebcash(text.trim());
			if (webcash) onSubmit(webcash);
		} catch {}
	};

	const handleInput = () => {
		const webcash = extractWebcash(input.trim());
		if (webcash) { onSubmit(webcash); input = ''; }
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
						if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
						cameraStream?.getTracks().forEach(t => t.stop());
						cameraStream = null;
						scanning = false;
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
	<p class="text-xs font-medium text-muted-foreground mb-3">Insert webcash</p>
	<div class="relative">
		<input
			type="text"
			bind:value={input}
			oninput={handleInput}
			onpaste={() => setTimeout(handleInput, 0)}
			placeholder="Paste webcash here..."
			class="w-full rounded-full border border-input bg-background pl-4 pr-20 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
			spellcheck="false"
			autocomplete="off"
			disabled={disabled}
		/>
		<button onclick={paste}
			class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all"
			disabled={disabled}>
			<ClipboardPaste class="w-3.5 h-3.5" /> Paste
		</button>
	</div>
	<button onclick={startScan}
		class="mt-3 w-full flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-all"
		disabled={disabled || scanning}>
		<ScanLine class="w-4 h-4" /> Scan QR
	</button>
</div>

{#if scanning}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex flex-col items-center justify-center px-5 animate-fade-in">
		<div class="absolute inset-0 bg-background/60 backdrop-blur-md" onclick={stopScan}></div>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="relative max-w-sm w-full animate-scale-in" onclick={(e) => e.stopPropagation()}>
			<button onclick={stopScan}
				class="flex items-center justify-center w-14 h-14 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200 mb-4 ml-auto"
				aria-label="Close">
				<X class="w-7 h-7" />
			</button>
			<div class="rounded-3xl overflow-hidden bg-black aspect-square relative">
				<video bind:this={videoEl} autoplay playsinline muted class="w-full h-full object-cover"></video>
				<canvas bind:this={canvasEl} class="hidden"></canvas>
				<div class="absolute inset-0 pointer-events-none">
					<div class="absolute inset-[12%] border-2 border-primary/40 rounded-2xl"></div>
				</div>
				<div class="absolute bottom-4 left-0 right-0 text-center">
					<span class="text-[12px] text-white/80 bg-black/50 backdrop-blur-sm px-4 py-2 rounded-full">{scanStatus}</span>
				</div>
			</div>
		</div>
	</div>
{/if}
