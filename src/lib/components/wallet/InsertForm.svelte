<script lang="ts">
	import { ArrowDownToLine, ClipboardPaste, ScanLine } from '@lucide/svelte';
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
			if (text.trim()) input = text.trim();
		} catch {}
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
					if (value.includes(':secret:') || value.startsWith('e')) {
						input = value;
						stopScan();
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
			class="w-full rounded-xl border border-input bg-background px-4 py-3 pr-20 text-sm font-mono h-20 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
			spellcheck="false"
		></textarea>
		<div class="absolute top-2 right-2 flex gap-1">
			<button onclick={paste}
				class="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all">
				<ClipboardPaste class="w-3.5 h-3.5" /> Paste
			</button>
		</div>
	</div>

	{#if scanning}
		<div class="mt-3 rounded-xl border border-border overflow-hidden bg-black aspect-square relative max-w-[280px] mx-auto">
			<video bind:this={videoEl} autoplay playsinline muted class="w-full h-full object-cover"></video>
			<canvas bind:this={canvasEl} class="hidden"></canvas>
			<div class="absolute inset-0 pointer-events-none">
				<div class="absolute inset-[12%] border border-primary rounded-2xl animate-pulse"></div>
			</div>
			<div class="absolute bottom-2 left-0 right-0 text-center">
				<span class="text-xs text-white bg-black/70 px-3 py-1 rounded-full">{scanStatus}</span>
			</div>
		</div>
		<button onclick={stopScan}
			class="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-all">
			Cancel scan
		</button>
	{/if}

	<div class="grid grid-cols-2 gap-2 mt-3">
		<button onclick={startScan}
			class="flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-all"
			disabled={scanning}>
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
