// Mining coordinator — manages Web Worker lifecycle.
// Testnet only. Fetches target, spawns worker, submits report.

import type { NetworkMode } from './types';
import * as Server from './server';

export interface MinerState {
	readonly running: boolean;
	readonly hashRate: number;
	readonly found: boolean;
	readonly result?: string;
}

type MinerCallback = (state: MinerState) => void;

let worker: Worker | null = null;

export const startMining = async (
	network: NetworkMode,
	masterSecret: string,
	miningDepth: number,
	onUpdate: MinerCallback
): Promise<void> => {
	if (network !== 'testnet') throw new Error('Mining only available on testnet');
	if (worker) stopMining();

	const target = await Server.getTarget(network);

	worker = new Worker(
		new URL('$lib/workers/miner.worker.ts', import.meta.url),
		{ type: 'module' }
	);

	worker.postMessage({
		masterSecret,
		miningDepth,
		difficulty: target.difficulty,
		miningAmount: target.mining_amount,
		subsidyAmount: target.mining_subsidy_amount ?? 0
	});

	worker.onmessage = async (e) => {
		const msg = e.data;
		if (msg.type === 'progress') {
			onUpdate({ running: true, hashRate: msg.hashRate, found: false });
		} else if (msg.type === 'found') {
			onUpdate({ running: false, hashRate: 0, found: true, result: msg.webcash });

			try {
				await Server.submitMiningReport(network, {
					preimage: msg.preimage,
					legalese: { terms: true }
				});
			} catch (e) {
				console.error('Mining report submission failed:', e);
			}

			stopMining();
		}
	};

	worker.onerror = () => {
		onUpdate({ running: false, hashRate: 0, found: false });
		stopMining();
	};
};

export const stopMining = (): void => {
	worker?.terminate();
	worker = null;
};

export const isMining = (): boolean => worker !== null;
