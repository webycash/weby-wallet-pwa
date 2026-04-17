<script lang="ts">
	import { startMining, stopMining, isMining, type MinerStats } from '$lib/core/miner';
	import { getMasterSecret, buildMiningParams, storeMined, parseWebcash } from '$lib/stores/wallet.svelte';
	import type { NetworkMode } from '$lib/core/types';
	import { Pickaxe, Square, Zap, Clock, Target, Hash, Trophy } from '@lucide/svelte';

	let { network, onBalanceUpdate }: { network: NetworkMode; onBalanceUpdate: () => void } = $props();

	let running = $state(false);
	let stats = $state<MinerStats>({ hashRate: 0, totalAttempts: 0, solutionsFound: 0, difficulty: 0, uptimeSecs: 0 });
	let result = $state('');
	let resultHash = $state('');
	let error = $state('');

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

	const toggle = async () => {
		if (running) {
			stopMining();
			running = false;
			return;
		}

		error = '';
		result = '';
		resultHash = '';

		try {
			const secret = await getMasterSecret();
			if (!secret) { error = 'No wallet found'; return; }

			// Build mining params via WASM — gets depth from wallet state
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
</script>

<div class="rounded-2xl border-2 border-border bg-card overflow-hidden">
	<!-- Header -->
	<div class="flex items-center justify-between px-5 py-4 border-b border-border">
		<div class="flex items-center gap-2">
			<Pickaxe class="w-4 h-4 text-primary" />
			<span class="text-sm font-semibold text-foreground">CPU Miner</span>
			<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-warning text-white font-medium">Testnet</span>
		</div>
		<button onclick={toggle}
			class="flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all
				{running
					? 'bg-danger text-danger-foreground border-2 border-danger hover:bg-danger'
					: 'bg-primary text-primary-foreground hover:bg-primary'}">
			{#if running}
				<Square class="w-3.5 h-3.5" />
				Stop
			{:else}
				<Zap class="w-3.5 h-3.5" />
				Start Mining
			{/if}
		</button>
	</div>

	<!-- Live stats -->
	{#if running || stats.totalAttempts > 0}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
			<div class="bg-card px-4 py-3">
				<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
					<Zap class="w-3 h-3" />
					<span class="text-[10px] uppercase tracking-wider font-medium">Speed</span>
				</div>
				<p class="text-lg font-bold text-foreground tabular-nums">{formatRate(stats.hashRate)}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
					<Hash class="w-3 h-3" />
					<span class="text-[10px] uppercase tracking-wider font-medium">Attempts</span>
				</div>
				<p class="text-lg font-bold text-foreground tabular-nums">{formatAttempts(stats.totalAttempts)}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
					<Target class="w-3 h-3" />
					<span class="text-[10px] uppercase tracking-wider font-medium">Difficulty</span>
				</div>
				<p class="text-lg font-bold text-foreground tabular-nums">{stats.difficulty}</p>
			</div>
			<div class="bg-card px-4 py-3">
				<div class="flex items-center gap-1.5 text-muted-foreground mb-1">
					<Clock class="w-3 h-3" />
					<span class="text-[10px] uppercase tracking-wider font-medium">ETA</span>
				</div>
				<p class="text-lg font-bold text-foreground tabular-nums">{stats.eta || '—'}</p>
			</div>
		</div>

		<!-- Progress bar -->
		{#if running && stats.progress !== undefined}
			<div class="h-1 bg-muted">
				<div class="h-full bg-warning transition-all duration-300" style="width: {Math.min(stats.progress, 100)}%"></div>
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
