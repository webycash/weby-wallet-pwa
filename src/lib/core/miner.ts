// Mining state flag — lets AppShell skip wallet-lock while mining is active.

export interface MinerStats {
	readonly hashRate: number;
	readonly totalAttempts: number;
	readonly solutionsFound: number;
	readonly difficulty: number;
	readonly uptimeSecs: number;
}

let _mining = false;

export const setMining = (v: boolean): void => { _mining = v; };
export const isMining = (): boolean => _mining;
export const stopMining = (): void => { _mining = false; };
