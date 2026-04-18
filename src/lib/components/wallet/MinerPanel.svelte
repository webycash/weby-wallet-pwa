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
	let gpuName = $state('');
	let gpuAvailable = $state(false);
	let useGpu = $state(false);
	let gpuInitializing = $state(false);
	let error = $state('');
	let result = $state('');
	let resultHash = $state('');

	// Mining stats
	let hashRate = $state(0);
	let totalAttempts = $state(0);
	let solutionsFound = $state(0);
	let solutionsSubmitted = $state(0);
	let difficulty = $state(0);
	let miningAmount = $state('');
	let uptimeSecs = $state(0);
	let cpuStats = $state<MinerStats>({ hashRate: 0, totalAttempts: 0, solutionsFound: 0, difficulty: 0, uptimeSecs: 0 });

	// Network stats
	let netStats = $state<any>(null);

	const fmt = (n: number): string => {
		if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
		if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
		if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
		return `${n}`;
	};
	const fmtRate = (r: number): string => {
		if (r >= 1e6) return `${(r / 1e6).toFixed(1)} MH/s`;
		if (r >= 1e3) return `${(r / 1e3).toFixed(1)} KH/s`;
		return `${r} H/s`;
	};
	const fmtEta = (rate: number, diff: number): string => {
		if (rate <= 0 || diff <= 0) return '—';
		const expected = Math.pow(2, diff) / rate;
		if (expected < 60) return `${Math.round(expected)}s`;
		if (expected < 3600) return `${(expected / 60).toFixed(1)}m`;
		return `${(expected / 3600).toFixed(1)}h`;
	};

	onMount(async () => {
		if ('gpu' in navigator) {
			gpuAvailable = true;
			gpuInitializing = true;
			try {
				const wasm = await getWasm();
				const name = await wasm.gpu_init();
				gpuName = name || 'WebGPU';
				useGpu = true;
			} catch (e) { console.warn('GPU init failed:', e); }
			gpuInitializing = false;
		}
		// Fetch network stats
		try {
			const res = await fetch('https://webcash.org/stats');
			netStats = await res.json();
		} catch { /* stats are optional */ }
	});

	const mineGpu = async () => {
		error = ''; result = ''; resultHash = '';
		running = true; solutionsFound = 0; solutionsSubmitted = 0; totalAttempts = 0;

		try {
			const wasm = await getWasm();
			const target = await Server.getTarget(network);
			const stateJson = await getRawState();
			if (!stateJson) { error = 'No wallet'; running = false; return; }

			difficulty = target.difficulty_target_bits;
			miningAmount = target.mining_amount;
			const startTime = Date.now();

			while (running) {
				const freshState = await getRawState();
				if (!freshState) break;

				const resultJson = await wasm.gpu_mine(freshState, target.difficulty_target_bits, target.mining_amount, target.mining_subsidy_amount || '0');
				const res = JSON.parse(resultJson);
				totalAttempts += res.attempted ?? 1_000_000;
				const elapsed = (Date.now() - startTime) / 1000;
				hashRate = Math.round(totalAttempts / Math.max(elapsed, 0.001));
				uptimeSecs = elapsed;

				if (res.found) {
					solutionsFound++;
					result = res.webcash_str;
					resultHash = res.hash_hex;

					try {
						await Server.submitMiningReport(network, { preimage: res.preimage_b64, legalese: { terms: true } });
						solutionsSubmitted++;
					} catch { /* best-effort */ }

					try {
						await storeMined(res.secret, Number(wasm.parse_amount(target.mining_amount)));
					} catch (e: any) { error = `Mined but failed to store: ${e.message}`; }

					onBalanceUpdate();
					// Continue mining — don't stop on solution
				}
			}
		} catch (e: any) { error = e.message || 'GPU mining failed'; }
		running = false;
	};

	const mineCpu = async () => {
		error = ''; result = ''; resultHash = '';
		solutionsFound = 0; solutionsSubmitted = 0;
		try {
			const secret = await getMasterSecret();
			if (!secret) { error = 'No wallet found'; return; }
			const params = await buildMiningParams(20, '200');
			running = true;
			await startMining(network, secret, params.mining_depth, async (state) => {
				running = state.running;
				cpuStats = state.stats;
				hashRate = state.stats.hashRate;
				totalAttempts = state.stats.totalAttempts;
				difficulty = state.stats.difficulty;
				uptimeSecs = state.stats.uptimeSecs;
				if (state.found && state.result) {
					solutionsFound++;
					result = state.result;
					resultHash = state.resultHash ?? '';
					try {
						const parsed = await parseWebcash(state.result);
						await storeMined(parsed.secret, parsed.amount_wats);
						solutionsSubmitted++;
					} catch (e: any) { error = `Mined but failed to store: ${e.message}`; }
					onBalanceUpdate();
				}
			});
		} catch (e: any) { error = e.message || 'Mining failed'; running = false; }
	};

	const toggle = async () => {
		if (running) { stopMining(); running = false; return; }
		if (useGpu) await mineGpu(); else await mineCpu();
	};
</script>

<div class="rounded-xl bg-card overflow-hidden">
	<!-- Header -->
	<div class="flex items-center justify-between px-5 py-4 border-b border-border">
		<div class="flex items-center gap-2">
			<Pickaxe class="w-4 h-4 text-primary" />
			<span class="text-sm font-semibold text-foreground">Miner</span>
			{#if gpuInitializing}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium animate-pulse">Detecting GPU...</span>
			{:else if useGpu}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-success text-white font-medium">{gpuName}</span>
			{:else}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">CPU</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if useGpu}
				<button onclick={() => { useGpu = false; }} class="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 transition-all">
					<Cpu class="w-3 h-3" /> CPU
				</button>
			{:else if gpuAvailable && gpuName}
				<button onclick={() => { useGpu = true; }} class="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 transition-all">
					<Monitor class="w-3 h-3" /> GPU
				</button>
			{/if}
			<button onclick={toggle} disabled={gpuInitializing}
				class="flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all disabled:opacity-50
					{running ? 'bg-danger text-danger-foreground hover:bg-danger' : 'bg-primary text-primary-foreground hover:bg-primary'}">
				{#if gpuInitializing}
					<Zap class="w-3.5 h-3.5 animate-pulse" /> Init...
				{:else if running}
					<Square class="w-3.5 h-3.5" /> Stop
				{:else}
					<Zap class="w-3.5 h-3.5" /> Start
				{/if}
			</button>
		</div>
	</div>

	<!-- Live stats -->
	{#if running || totalAttempts > 0}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Speed</p>
				<p class="text-lg font-bold text-foreground tabular-nums">{fmtRate(hashRate)}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">ETA</p>
				<p class="text-lg font-bold text-foreground tabular-nums">{fmtEta(hashRate, difficulty)}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Solutions</p>
				<p class="text-lg font-bold text-foreground tabular-nums">{solutionsSubmitted}/{solutionsFound}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reward</p>
				<p class="text-lg font-bold text-foreground tabular-nums">{miningAmount || '—'} ₩</p>
			</div>
		</div>
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-t border-border">
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Difficulty</p>
				<p class="text-sm font-semibold text-foreground tabular-nums">{difficulty}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Attempts</p>
				<p class="text-sm font-semibold text-foreground tabular-nums">{fmt(totalAttempts)}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Backend</p>
				<p class="text-sm font-semibold text-foreground">{useGpu ? 'WebGPU' : 'CPU'}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Uptime</p>
				<p class="text-sm font-semibold text-foreground tabular-nums">{Math.floor(uptimeSecs / 60)}m {Math.floor(uptimeSecs % 60)}s</p>
			</div>
		</div>
	{/if}

	<!-- Network stats -->
	{#if netStats}
		<div class="px-4 py-3 border-t border-border">
			<p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Network</p>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
				<div>
					<p class="text-muted-foreground">Circulation</p>
					<p class="font-semibold text-foreground">{netStats.circulation_formatted}</p>
				</div>
				<div>
					<p class="text-muted-foreground">Epoch</p>
					<p class="font-semibold text-foreground">{netStats.epoch}</p>
				</div>
				<div>
					<p class="text-muted-foreground">Mining Reports</p>
					<p class="font-semibold text-foreground">{netStats.mining_reports?.toLocaleString()}</p>
				</div>
				<div>
					<p class="text-muted-foreground">Subsidy</p>
					<p class="font-semibold text-foreground">{netStats.mining_subsidy_amount} ₩</p>
				</div>
			</div>
		</div>
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
