// Network mode store — production or testnet.

import type { NetworkMode } from '$lib/core/types';

const KEY = 'weby_network_mode';

export const getNetwork = (): NetworkMode => {
	if (typeof localStorage === 'undefined') return 'production';
	return (localStorage.getItem(KEY) as NetworkMode) ?? 'production';
};

export const setNetwork = (mode: NetworkMode): void => {
	if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, mode);
};
