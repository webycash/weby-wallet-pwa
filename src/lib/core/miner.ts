// CPU mining coordinator — manages Web Worker lifecycle.
// Target fetch and report submission via WASM (no JS fetch calls).

import type { NetworkMode } from './types';
import { getWasm } from './wasm';

export interface MinerStats {
	readonly hashRate: number;
	readonly totalAttempts: number;
	readonly solutionsFound: number;
	readonly difficulty: number;
	readonly uptimeSecs: number;
	readonly eta?: string;
	readonly progress?: number;
}

export interface MinerState {
	readonly running: boolean;
	readonly stats: MinerStats;
	readonly found: boolean;
	readonly result?: string;
	readonly resultHash?: string;
}

type MinerCallback = (state: MinerState) => void;

let worker: Worker | null = null;

const emptyStats: MinerStats = {
	hashRate: 0, totalAttempts: 0, solutionsFound: 0, difficulty: 0, uptimeSecs: 0
};

export const startMining = async (
	network: NetworkMode,
	masterSecret: string,
	miningDepth: number,
	onUpdate: MinerCallback
): Promise<void> => {
	if (worker) stopMining();

	const wasm = await getWasm();
	const targetJson = await wasm.get_mining_target(network);
	const target = JSON.parse(targetJson);

	worker = new Worker(
		new URL('$lib/workers/miner.worker.ts', import.meta.url),
		{ type: 'module' }
	);

	worker.postMessage({
		masterSecret,
		miningDepth,
		difficulty: target.difficulty_target_bits,
		miningAmount: target.mining_amount,
	});

	worker.onmessage = async (e) => {
		const msg = e.data;
		if (msg.type === 'progress') {
			onUpdate({
				running: true,
				stats: msg.stats,
				found: false,
			});
		} else if (msg.type === 'found') {
			onUpdate({
				running: false,
				stats: msg.stats,
				found: true,
				result: msg.webcash,
				resultHash: msg.hash,
			});
			stopMining();
		}
	};

	worker.onerror = () => {
		onUpdate({ running: false, stats: emptyStats, found: false });
		stopMining();
	};
};

export const stopMining = (): void => {
	worker?.terminate();
	worker = null;
};

export const isMining = (): boolean => worker !== null;
