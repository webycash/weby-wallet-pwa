// Mining coordinator — manages Web Worker lifecycle.
// Testnet only. Fetches target, spawns worker, submits report.

import type { NetworkMode } from './types';
import * as Server from './server';

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
	// Mining available on all networks.
	if (worker) stopMining();

	const target = await Server.getTarget(network);

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

			try {
				await Server.submitMiningReport(network, {
					preimage: msg.preimage,
					legalese: { terms: true }
				});
			} catch {
				// Mining report submission failed — output still stored locally
			}

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
