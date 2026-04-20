// CPU mining coordinator — legacy, replaced by GPU mining in MinerPanel.
// Kept as stub for type compatibility.

export interface MinerStats {
	readonly hashRate: number;
	readonly totalAttempts: number;
	readonly solutionsFound: number;
	readonly difficulty: number;
	readonly uptimeSecs: number;
}

export const stopMining = (): void => {};
export const isMining = (): boolean => false;
