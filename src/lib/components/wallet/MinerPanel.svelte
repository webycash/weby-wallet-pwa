<script lang="ts">
	import { startMining, stopMining, isMining, type MinerStats } from '$lib/core/miner';
	import { getMasterSecret, getDb } from '$lib/stores/wallet.svelte';
	import { getDepth, setDepth, putOutput, getUnspent } from '$lib/core/storage';
	import { getWasm } from '$lib/core/wasm';
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

			const db = await getDb();
			const depth = await getDepth(db, 'MINING');

			running = true;

			await startMining(network, secret, depth, async (state) => {
				running = state.running;
				stats = state.stats;
				if (state.found && state.result) {
					result = state.result;
					resultHash = state.resultHash ?? '';
					// Store mined webcash in wallet
					try {
						const db = await getDb();
						const wasm = await getWasm();
						// Store directly — no /replace needed, we own the HD-derived secret
						const parsed = wasm.parse_webcash(state.result);
						const hashHex = await wasm.secret_to_public(parsed.secret);
						const hashBytes = new Uint8Array(hashHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
						await putOutput(db, {
							secretHash: hashBytes.buffer as ArrayBuffer,
							secret: parsed.secret,
							amount: parsed.amount_wats,
							createdAt: new Date().toISOString(),
							spent: 0
						});
						await setDepth(db, 'MINING', depth + 1);
						// Verify storage persisted
						const verify = await getUnspent(db);
						console.log(`[Miner] Stored output. Verified ${verify.length} unspent outputs in DB.`);
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
			<Pickaxe class="w-4 h-4 text-amber-500" />
			<span class="text-sm font-semibold text-foreground">CPU Miner</span>
			<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-medium">Testnet</span>
		</div>
		<button onclick={toggle}
			class="flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all
				{running
					? 'bg-red-500/10 text-red-500 border-2 border-red-500/20 hover:bg-red-500/20'
					: 'bg-primary text-primary-foreground hover:bg-primary/90'}">
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
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/30">
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
			<div class="h-1 bg-muted/50">
				<div class="h-full bg-amber-500 transition-all duration-300" style="width: {Math.min(stats.progress, 100)}%"></div>
			</div>
		{/if}
	{/if}

	<!-- Solution found -->
	{#if result}
		<div class="px-5 py-4 bg-emerald-500/5 border-t border-emerald-500/20">
			<div class="flex items-center gap-2 mb-2">
				<Trophy class="w-4 h-4 text-emerald-500" />
				<span class="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Solution Found!</span>
			</div>
			<div class="space-y-1">
				<p class="text-[10px] text-muted-foreground uppercase tracking-wider">Hash</p>
				<code class="text-xs font-mono text-muted-foreground break-all block">{resultHash}</code>
			</div>
			<div class="mt-2 space-y-1">
				<p class="text-[10px] text-muted-foreground uppercase tracking-wider">Webcash</p>
				<code class="text-xs font-mono text-foreground break-all block">{result}</code>
			</div>
		</div>
	{/if}

	{#if error}
		<div class="px-5 py-3 bg-red-500/5 border-t border-red-500/20">
			<p class="text-sm text-red-500">{error}</p>
		</div>
	{/if}
</div>
