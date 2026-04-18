<script lang="ts">
	import { onMount } from 'svelte';
	import { startMining, stopMining, type MinerStats } from '$lib/core/miner';
	import { getMasterSecret, buildMiningParams, storeMined, parseWebcash, getRawState } from '$lib/stores/wallet.svelte';
	import * as Server from '$lib/core/server';
	import { getWasm } from '$lib/core/wasm';
	import type { NetworkMode } from '$lib/core/types';
	import { Pickaxe, Square, Zap, Clock, Target, Hash, Trophy, Cpu, Monitor } from '@lucide/svelte';

	let { network, onBalanceUpdate }: { network: NetworkMode; onBalanceUpdate: () => void } = $props();

	let running = $state(false);
	let stats = $state<MinerStats>({ hashRate: 0, totalAttempts: 0, solutionsFound: 0, difficulty: 0, uptimeSecs: 0 });
	let result = $state('');
	let resultHash = $state('');
	let error = $state('');
	let gpuName = $state('');
	let gpuAvailable = $state(false);
	let useGpu = $state(false);
	let gpuInitializing = $state(false);

	const formatRate = (rate: number): string => {
		if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(1)} MH/s`;
		if (rate >= 1_000) return `${(rate / 1_000).toFixed(1)} KH/s`;
		return `${rate} H/s`;
	};

	const formatAttempts = (n: number): string => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return `${n}`;
	};

	onMount(async () => {
		// Auto-init GPU mining (default). Falls back to CPU if unavailable.
		if ('gpu' in navigator) {
			gpuAvailable = true;
			gpuInitializing = true;
			try {
				const wasm = await getWasm();
				const name = await wasm.gpu_init();
				// gpu_init returns adapter name (may be empty on WebGPU) or throws on failure
				gpuName = name || 'WebGPU';
				useGpu = true;
			} catch (e) { console.warn('GPU init failed:', e); }
			gpuInitializing = false;
		}
	});

	const initGpu = async () => {
		gpuInitializing = true;
		error = '';
		try {
			const wasm = await getWasm();
			const name = await wasm.gpu_init();
			gpuName = name || 'WebGPU';
			useGpu = true;
		} catch (e: any) {
			error = `GPU init failed: ${e.message || e}`;
			gpuAvailable = false;
		}
		gpuInitializing = false;
	};

	const mineGpu = async () => {
		error = '';
		result = '';
		resultHash = '';
		running = true;

		try {
			const wasm = await getWasm();
			const target = await Server.getTarget(network);
			const stateJson = await getRawState();
			if (!stateJson) { error = 'No wallet'; running = false; return; }

			stats = { ...stats, difficulty: target.difficulty_target_bits };

			let totalAttempted = 0;
			const startTime = Date.now();

			// GPU mining loop — each call mines 1M nonces
			while (running) {
				const freshState = await getRawState();
				if (!freshState) break;

				const resultJson = await wasm.gpu_mine(freshState, target.difficulty_target_bits, target.mining_amount);
				const res = JSON.parse(resultJson);
				totalAttempted += res.attempted ?? 1_000_000;

				const elapsed = (Date.now() - startTime) / 1000;
				stats = {
					hashRate: Math.round(totalAttempted / Math.max(elapsed, 0.001)),
					totalAttempts: totalAttempted,
					solutionsFound: res.found ? 1 : 0,
					difficulty: target.difficulty_target_bits,
					uptimeSecs: elapsed,
				};

				if (res.found) {
					result = res.webcash_str;
					resultHash = res.hash_hex;
					running = false;

					// Submit mining report
					try {
						await Server.submitMiningReport(network, {
							preimage: res.preimage_b64,
							legalese: { terms: true }
						});
					} catch { /* report submission is best-effort */ }

					// Store mined output
					try {
						await storeMined(res.secret, Number(wasm.parse_amount(target.mining_amount)));
					} catch (e: any) {
						error = `Mined but failed to store: ${e.message}`;
					}
					onBalanceUpdate();
					break;
				}
			}
		} catch (e: any) {
			error = e.message || 'GPU mining failed';
		}
		running = false;
	};

	const mineCpu = async () => {
		error = '';
		result = '';
		resultHash = '';

		try {
			const secret = await getMasterSecret();
			if (!secret) { error = 'No wallet found'; return; }

			const params = await buildMiningParams(20, '200');
			running = true;

			await startMining(network, secret, params.mining_depth, async (state) => {
				running = state.running;
				stats = state.stats;
				if (state.found && state.result) {
					result = state.result;
					resultHash = state.resultHash ?? '';
					try {
						const parsed = await parseWebcash(state.result);
						await storeMined(parsed.secret, parsed.amount_wats);
					} catch (e: any) {
						error = `Mined but failed to store: ${e.message}`;
					}
					onBalanceUpdate();
				}
			});
		} catch (e: any) {
			error = e.message || 'Mining failed';
			running = false;
		}
	};

	const toggle = async () => {
		if (running) {
			stopMining();
			running = false;
			return;
		}
		if (useGpu) {
			await mineGpu();
		} else {
			await mineCpu();
		}
	};
</script>

<div class="rounded-xl bg-card border border-border overflow-hidden">
	<!-- Header -->
	<div class="flex items-center justify-between px-5 py-4 border-b border-border">
		<div class="flex items-center gap-2">
			<Pickaxe class="w-4 h-4 text-muted-foreground" />
			<span class="text-sm font-semibold text-foreground">Miner</span>
			{#if gpuInitializing}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Detecting GPU...</span>
			{:else if useGpu && gpuName}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-success text-white font-medium truncate max-w-[140px]">{gpuName}</span>
			{:else}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">CPU</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if useGpu}
				<button onclick={() => { useGpu = false; }}
					class="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 transition-all">
					<Cpu class="w-3 h-3" /> CPU
				</button>
			{:else if gpuAvailable && gpuName}
				<button onclick={() => { useGpu = true; }}
					class="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 transition-all">
					<Monitor class="w-3 h-3" /> GPU
				</button>
			{/if}
			<button onclick={toggle} disabled={gpuInitializing}
				class="flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all disabled:opacity-50
					{running
						? 'bg-danger text-danger-foreground hover:bg-danger'
						: 'bg-primary text-primary-foreground hover:bg-primary'}">
				{#if gpuInitializing}
					<Zap class="w-3.5 h-3.5 animate-pulse" /> Initializing GPU...
				{:else if running}
					<Square class="w-3.5 h-3.5" /> Stop
				{:else}
					<Zap class="w-3.5 h-3.5" /> Start
				{/if}
			</button>
		</div>
	</div>

	<!-- Live stats -->
	{#if running || stats.totalAttempts > 0}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-6 px-5 py-4">
			<div>
				<p class="text-xs text-muted-foreground mb-1">Speed</p>
				<p class="text-lg font-semibold text-foreground tabular-nums">{formatRate(stats.hashRate)}</p>
			</div>
			<div>
				<p class="text-xs text-muted-foreground mb-1">Attempts</p>
				<p class="text-lg font-semibold text-foreground tabular-nums">{formatAttempts(stats.totalAttempts)}</p>
			</div>
			<div>
				<p class="text-xs text-muted-foreground mb-1">Difficulty</p>
				<p class="text-lg font-semibold text-foreground tabular-nums">{stats.difficulty}</p>
			</div>
			<div>
				<p class="text-xs text-muted-foreground mb-1">{useGpu ? 'Backend' : 'ETA'}</p>
				<p class="text-lg font-semibold text-foreground tabular-nums">{useGpu ? 'WebGPU' : (stats.eta || '—')}</p>
			</div>
		</div>

		{#if running && stats.progress !== undefined && !useGpu}
			<div class="h-0.5 bg-muted mx-5">
				<div class="h-full bg-primary transition-all duration-300" style="width: {Math.min(stats.progress, 100)}%"></div>
			</div>
		{/if}
	{/if}

	<!-- Solution found -->
	{#if result}
		<div class="px-5 py-4 bg-success border-t border-success text-success-foreground">
			<div class="flex items-center gap-2 mb-2">
				<Trophy class="w-4 h-4" />
				<span class="text-sm font-semibold">Solution Found!</span>
			</div>
			<div class="space-y-1">
				<p class="text-[10px] uppercase tracking-wider opacity-80">Hash</p>
				<code class="text-xs font-mono break-all block opacity-90">{resultHash}</code>
			</div>
			<div class="mt-2 space-y-1">
				<p class="text-[10px] uppercase tracking-wider opacity-80">Webcash</p>
				<code class="text-xs font-mono break-all block">{result}</code>
			</div>
		</div>
	{/if}

	{#if error}
		<div class="px-5 py-3 bg-danger border-t border-danger text-danger-foreground">
			<p class="text-sm">{error}</p>
		</div>
	{/if}
</div>
