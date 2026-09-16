// Network mode store — derived from signed/runtime config (fail closed).

import type { NetworkMode } from '$lib/core/types';
import { getRuntimeConfig } from '$lib/extro/runtime-config';
import {
	allowedNetworkForDeployment,
	NetworkRoutingError
} from '$lib/core/webcash-routing';

const KEY = 'weby_network_mode';

export { NetworkRoutingError };

export const allowedNetwork = (): NetworkMode =>
	allowedNetworkForDeployment(getRuntimeConfig().deployment);

/**
 * Align persisted `weby_network_mode` with the loaded runtime deployment.
 * Fresh profiles receive the allowed mode; a conflicting stored value fails closed.
 */
export const syncNetworkFromRuntimeConfig = (): NetworkMode => {
	const allowed = allowedNetwork();
	if (typeof localStorage === 'undefined') return allowed;
	const stored = localStorage.getItem(KEY) as NetworkMode | null;
	if (stored && stored !== allowed) {
		throw new NetworkRoutingError(
			`stored_network_mode_conflict:stored=${stored}:allowed=${allowed}:deployment=${getRuntimeConfig().deployment}`
		);
	}
	localStorage.setItem(KEY, allowed);
	return allowed;
};

export const getNetwork = (): NetworkMode => {
	const allowed = allowedNetwork();
	if (typeof localStorage === 'undefined') return allowed;
	const stored = localStorage.getItem(KEY) as NetworkMode | null;
	if (!stored) {
		localStorage.setItem(KEY, allowed);
		return allowed;
	}
	if (stored !== allowed) {
		throw new NetworkRoutingError(
			`weby_network_mode_prohibited:stored=${stored}:allowed=${allowed}:deployment=${getRuntimeConfig().deployment}`
		);
	}
	return stored;
};

export const setNetwork = (mode: NetworkMode): void => {
	const allowed = allowedNetwork();
	if (mode !== allowed) {
		throw new NetworkRoutingError(
			`set_network_prohibited:requested=${mode}:allowed=${allowed}:deployment=${getRuntimeConfig().deployment}`
		);
	}
	if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, mode);
};
