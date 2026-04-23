<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { isMining, setMining, stopMining, type MinerStats } from '$lib/core/miner';
	import { getMasterSecret, getRawState, setRawState } from '$lib/stores/wallet.svelte';
	import { getWasm } from '$lib/core/wasm';
	import type { NetworkMode } from '$lib/core/types';
	import { acquireWakeLock, releaseWakeLock, reacquireWakeLock, startAudioKeepAlive, stopAudioKeepAlive } from '$lib/core/keep-alive';
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

	// ── Snapshot persistence (survives background / page reload) ──
	const SNAPSHOT_KEY = 'weby_mining_snapshot';
	let mineStartTime = 0;

	const saveSnapshot = () => {
		try {
			localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
				active: true, startedAtMs: mineStartTime,
				totalAttempts, solutionsFound, solutionsSubmitted,
				difficulty, miningAmount, hashRate, history,
			}));
		} catch { /* quota — best effort */ }
	};
	const loadSnapshot = (): any | null => {
		try { const r = localStorage.getItem(SNAPSHOT_KEY); return r ? JSON.parse(r) : null; }
		catch { return null; }
	};
	const clearSnapshot = () => localStorage.removeItem(SNAPSHOT_KEY);

	const startKeepAlive = async () => { await acquireWakeLock(); startAudioKeepAlive(); };
	const stopKeepAlive = () => { releaseWakeLock(); stopAudioKeepAlive(); };

	const handleMinerVisibility = async () => {
		if (document.visibilityState === 'hidden') {
			if (running) saveSnapshot();
		} else if (running) {
			await reacquireWakeLock();
		}
	};

	const fmt = (n: number): string => {
		if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
		if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
		if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
		return `${n}`;
	};
	const fmtCompact = (v: string | number): string => {
		const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
		if (isNaN(n)) return `${v}`;
		if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
		if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
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

		document.addEventListener('visibilitychange', handleMinerVisibility);

		// Auto-resume from saved snapshot (page reload / iOS tab kill)
		const snap = loadSnapshot();
		if (snap?.active && useGpu && !isMining()) {
			clearSnapshot();
			mineGpu(snap);
		}
	});

	onDestroy(() => {
		document.removeEventListener('visibilitychange', handleMinerVisibility);
		if (running) {
			running = false;
			saveSnapshot();
			setMining(false);
			stopKeepAlive();
		}
	});

	const mineGpu = async (resume?: any) => {
		if (isMining()) return; // guard against concurrent GPU access
		error = ''; result = ''; resultHash = '';
		running = true;
		setMining(true);
		await startKeepAlive();

		if (resume) {
			totalAttempts = resume.totalAttempts ?? 0;
			solutionsFound = resume.solutionsFound ?? 0;
			solutionsSubmitted = resume.solutionsSubmitted ?? 0;
			difficulty = resume.difficulty ?? 0;
			miningAmount = resume.miningAmount ?? '';
			hashRate = resume.hashRate ?? 0;
			history = resume.history ?? [];
		} else {
			solutionsFound = 0; solutionsSubmitted = 0; totalAttempts = 0;
		}

		try {
			const wasm = await getWasm();
			const stateJson = await getRawState();
			if (!stateJson) { error = 'No wallet'; running = false; setMining(false); stopKeepAlive(); return; }

			const startTime = resume?.startedAtMs ?? Date.now();
			mineStartTime = startTime;

			while (running) {
				const freshState = await getRawState();
				if (!freshState) break;

				const rawResult = await wasm.gpu_mine(freshState, network);
				let res: any;
				if (typeof rawResult === 'string') {
					res = JSON.parse(rawResult);
				} else if ((rawResult as any) instanceof Map) {
					res = Object.fromEntries(rawResult as any);
				} else {
					res = rawResult;
				}

				if (res.state) {
					const stateVal = typeof res.state === 'string' ? res.state : JSON.stringify(res.state);
					await setRawState(stateVal);
				}
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
					saveSnapshot();
				}
			}
		} catch (e: any) { error = e.message || 'GPU mining failed'; }
		running = false;
		setMining(false);
		stopKeepAlive();
		clearSnapshot();
	};

	const toggle = async () => {
		if (running) {
			stopMining(); running = false;
			setMining(false); stopKeepAlive(); clearSnapshot();
			return;
		}
		if (useGpu) await mineGpu();
	};
</script>

<div class="space-y-5">
	<!-- Header + Start/Stop -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<Pickaxe class="w-[18px] h-[18px] text-primary opacity-60" />
			<span class="text-[17px] font-semibold text-foreground">Miner</span>
			{#if gpuInitializing}
				<span class="text-[10px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground font-medium animate-pulse">Detecting GPU...</span>
			{:else if useGpu}
				<span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{gpuName}</span>
			{:else}
				<span class="text-[10px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground font-medium">GPU</span>
			{/if}
		</div>
		<button onclick={toggle} disabled={gpuInitializing || !gpuAvailable}
			class="flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium transition-all duration-200 active:scale-[0.97] disabled:opacity-30
				{running ? 'bg-muted/60 text-foreground hover:bg-muted/80' : 'bg-primary text-primary-foreground hover:opacity-90'}">
			{#if gpuInitializing}
				<Zap class="w-3.5 h-3.5 animate-pulse" /> Init...
			{:else if running}
				<Square class="w-3.5 h-3.5" /> Stop
			{:else}
				<Zap class="w-3.5 h-3.5" /> Start
			{/if}
		</button>
	</div>

	<!-- Mining cost -->
	<p class="text-[11px] text-muted-foreground/60">Mining cost: ~ ${(0.24 / Math.min(3600 / (Math.pow(2, 28) / (14.5e9)), 600) / 195.3125).toFixed(6)}/₩</p>

	<!-- Live stats -->
	{#if running || totalAttempts > 0}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Speed</p>
				<p class="text-[19px] font-normal text-foreground tabular-nums">{fmtRate(hashRate)}</p>
			</div>
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">ETA</p>
				<p class="text-[19px] font-normal text-foreground tabular-nums">{fmtEta(hashRate, difficulty)}</p>
			</div>
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Solutions</p>
				<p class="text-[19px] font-normal text-foreground tabular-nums">{solutionsSubmitted}/{solutionsFound}</p>
			</div>
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Reward</p>
				<p class="text-[19px] font-normal text-foreground tabular-nums">{miningAmount || '\u2014'} W</p>
			</div>
		</div>
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Difficulty</p>
				<p class="text-[14px] font-medium text-foreground tabular-nums">{difficulty}</p>
			</div>
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Attempts</p>
				<p class="text-[14px] font-medium text-foreground tabular-nums">{fmt(totalAttempts)}</p>
			</div>
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Backend</p>
				<p class="text-[14px] font-medium text-foreground">WebGPU</p>
			</div>
			<div class="rounded-2xl bg-card p-3.5">
				<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Uptime</p>
				<p class="text-[14px] font-medium text-foreground tabular-nums">{Math.floor(uptimeSecs / 60)}m {Math.floor(uptimeSecs % 60)}s</p>
			</div>
		</div>
	{/if}

	<!-- Network stats -->
	{#if netStats}
		<div>
			<p class="text-[10px] text-muted-foreground/60 tracking-wide mb-3">Network</p>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div class="rounded-2xl bg-card p-3.5">
					<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Circulation</p>
					<p class="text-[13px] font-medium text-foreground tabular-nums">{fmtCompact(netStats.circulation_formatted)}</p>
				</div>
				<div class="rounded-2xl bg-card p-3.5">
					<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Epoch</p>
					<p class="text-[13px] font-medium text-foreground tabular-nums">{netStats.epoch}</p>
				</div>
				<div class="rounded-2xl bg-card p-3.5">
					<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Mining Reports</p>
					<p class="text-[13px] font-medium text-foreground tabular-nums">{fmtCompact(netStats.mining_reports ?? 0)}</p>
				</div>
				<div class="rounded-2xl bg-card p-3.5">
					<p class="text-[10px] text-muted-foreground mb-1 tracking-wide">Subsidy</p>
					<p class="text-[13px] font-medium text-foreground tabular-nums">{netStats.mining_subsidy_amount} W</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Solution found -->
	{#if result}
		<div class="rounded-2xl bg-primary/10 p-5">
			<div class="flex items-center gap-2 mb-3">
				<Trophy class="w-4 h-4 text-primary" />
				<span class="text-[14px] font-medium text-primary">Solution Found</span>
			</div>
			<div class="space-y-2">
				<p class="text-[10px] text-muted-foreground tracking-wide">Hash</p>
				<code class="text-[11px] font-mono break-all block text-foreground/70">{resultHash}</code>
			</div>
			<div class="mt-3 space-y-2">
				<p class="text-[10px] text-muted-foreground tracking-wide">Webcash</p>
				<code class="text-[11px] font-mono break-all block text-foreground">{result}</code>
			</div>
		</div>
	{/if}

	<!-- Mining history -->
	{#if history.length > 0}
		<div>
			<button onclick={() => showHistory = !showHistory}
				class="w-full flex items-center justify-between py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-all duration-200">
				<span>Solutions ({history.length})</span>
				<span class="text-[10px]">{showHistory ? 'Hide' : 'Show'}</span>
			</button>
			{#if showHistory}
				<div class="rounded-2xl bg-card p-4 mt-1">
					<table class="w-full text-[11px]">
						<thead>
							<tr class="text-muted-foreground text-left">
								<th class="pb-2 font-medium">Time</th>
								<th class="pb-2 font-medium">Hash</th>
								<th class="pb-2 font-medium text-right">Zeros</th>
								<th class="pb-2 font-medium text-right">Amount</th>
								<th class="pb-2 font-medium text-right">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each history.toReversed() as s}
								<tr>
									<td class="py-1.5 tabular-nums">{s.time}</td>
									<td class="py-1.5 font-mono text-[10px] opacity-50">{s.hash.slice(0, 16)}...</td>
									<td class="py-1.5 tabular-nums text-right">{s.difficulty}</td>
									<td class="py-1.5 tabular-nums text-right">{s.amount}</td>
									<td class="py-1.5 text-right text-primary">{s.submitted ? 'OK' : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}

	{#if error}
		<div class="rounded-2xl bg-muted/50 px-4 py-3 text-[13px] text-foreground">
			{error}
		</div>
	{/if}
</div>
