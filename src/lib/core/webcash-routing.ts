// Fail-closed Webcash routing — the signed/runtime config is the only
// authority for which server the wallet WASM may contact.

import type { NetworkMode } from './types';
import type { DeploymentTier, ExtroRuntimeConfig } from '$lib/extro/runtime-config';

export class NetworkRoutingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NetworkRoutingError';
	}
}

/** UI/persistence network mode permitted by a deployment profile. */
export function allowedNetworkForDeployment(deployment: DeploymentTier): NetworkMode {
	return deployment === 'production' ? 'production' : 'testnet';
}

/** True when a hostname is the live production Webcash origin. */
export function isProductionWebcashHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return host === 'webcash.org' || host.endsWith('.webcash.org');
}

/**
 * Resolve the exact base URL passed into wallet WASM (`NetworkMode::Custom`).
 * Development profiles must never select the production Webcash host.
 */
export function resolveWebcashWasmNetwork(config: ExtroRuntimeConfig): string {
	const raw = config.webcash_server_url?.trim();
	if (!raw) {
		throw new NetworkRoutingError('missing_webcash_server_url');
	}
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new NetworkRoutingError(`invalid_webcash_server_url:${raw}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new NetworkRoutingError(`unsupported_webcash_server_url_scheme:${parsed.protocol}`);
	}
	if (config.deployment === 'development' && isProductionWebcashHost(parsed.hostname)) {
		throw new NetworkRoutingError('development_must_not_select_production_webcash');
	}
	if (
		config.deployment === 'production' &&
		allowedNetworkForDeployment(config.deployment) === 'production' &&
		!isProductionWebcashHost(parsed.hostname) &&
		parsed.hostname !== 'weby.cash' &&
		!parsed.hostname.endsWith('.weby.cash')
	) {
		// Production may use weby.cash production rails; still reject accidental
		// localhost / placeholder hosts (runtime-config already covers most of this).
		if (
			/^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(parsed.hostname) ||
			parsed.hostname.endsWith('.local')
		) {
			throw new NetworkRoutingError('production_webcash_url_points_to_local_host');
		}
	}
	return raw.replace(/\/$/, '');
}
