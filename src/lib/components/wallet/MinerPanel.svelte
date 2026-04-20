<script lang="ts">
	import { onMount } from 'svelte';
	import { stopMining, type MinerStats } from '$lib/core/miner';
	import { getMasterSecret, getRawState, setRawState } from '$lib/stores/wallet.svelte';
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

	let hashRate = $state(0);
	let totalAttempts = $state(0);
	let solutionsFound = $state(0);
	let solutionsSubmitted = $state(0);
	let difficulty = $state(0);
	let miningAmount = $state('');
	let uptimeSecs = $state(0);

	let netStats = $state<any>(null);
	let showHistory = $state(false);

	interface MinedSolution {
		time: string;
		hash: string;
		difficulty: number;
		amount: string;
		submitted: boolean;
	}
	let history = $state<MinedSolution[]>([]);

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
		if (rate <= 0 || diff <= 0) return '\u2014';
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
			const stateJson = await getRawState();
			if (!stateJson) { error = 'No wallet'; running = false; return; }

			const startTime = Date.now();

			while (running) {
				const freshState = await getRawState();
				if (!freshState) break;

				const resultJson = await wasm.gpu_mine(freshState, network);
				const res = JSON.parse(resultJson);

				if (res.state) await setRawState(res.state);
				if (res.difficulty) difficulty = res.difficulty;
				if (res.mining_amount) miningAmount = res.mining_amount;

				totalAttempts += res.attempted ?? 1_000_000;
				const elapsed = (Date.now() - startTime) / 1000;
				hashRate = Math.round(totalAttempts / Math.max(elapsed, 0.001));
				uptimeSecs = elapsed;

				if (res.found) {
					solutionsFound++;
					solutionsSubmitted++;
					resultHash = res.hash_hex;

					history = [...history, {
						time: new Date().toLocaleTimeString(),
						hash: res.hash_hex,
						difficulty: res.difficulty_achieved,
						amount: miningAmount,
						submitted: true,
					}];

					onBalanceUpdate();
				}
			}
		} catch (e: any) { error = e.message || 'GPU mining failed'; }
		running = false;
	};

	const toggle = async () => {
		if (running) { stopMining(); running = false; return; }
		if (useGpu) await mineGpu();
	};
</script>

<div class="rounded-xl bg-card border border-border overflow-hidden">
	<!-- Mining cost -->
	<div class="px-5 pt-4 pb-2">
		<p class="text-xs text-muted-foreground">Mining cost: ~ ${(0.24 / Math.min(3600 / (Math.pow(2, 28) / (14.5e9)), 600) / 195.3125).toFixed(6)}/₩</p>
	</div>
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
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">GPU</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<button onclick={toggle} disabled={gpuInitializing || !gpuAvailable}
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
				<p class="text-lg font-bold text-foreground tabular-nums">{miningAmount || '\u2014'} W</p>
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
				<p class="text-sm font-semibold text-foreground">WebGPU</p>
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
					<p class="font-semibold text-foreground">{netStats.mining_subsidy_amount} W</p>
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

	<!-- Mining history -->
	{#if history.length > 0}
		<div class="border-t border-border">
			<button onclick={() => showHistory = !showHistory}
				class="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors">
				<span>Solutions ({history.length})</span>
				<span class="text-[10px]">{showHistory ? 'Hide' : 'Show'}</span>
			</button>
			{#if showHistory}
				<div class="px-4 pb-3">
					<table class="w-full text-xs">
						<thead>
							<tr class="text-muted-foreground text-left">
								<th class="pb-1.5 font-medium">Time</th>
								<th class="pb-1.5 font-medium">Hash</th>
								<th class="pb-1.5 font-medium text-right">Zeros</th>
								<th class="pb-1.5 font-medium text-right">Amount</th>
								<th class="pb-1.5 font-medium text-right">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each history.toReversed() as s}
								<tr class="border-t border-border/50">
									<td class="py-1.5 tabular-nums">{s.time}</td>
									<td class="py-1.5 font-mono text-[10px] opacity-70">{s.hash.slice(0, 16)}...</td>
									<td class="py-1.5 tabular-nums text-right">{s.difficulty}</td>
									<td class="py-1.5 tabular-nums text-right">{s.amount}</td>
									<td class="py-1.5 text-right">{s.submitted ? 'OK' : 'Failed'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}

	{#if error}
		<div class="px-5 py-3 bg-danger border-t border-danger text-danger-foreground">
			<p class="text-sm">{error}</p>
		</div>
	{/if}
</div>
