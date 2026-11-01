import type { ExtroClient } from '@extro/node';
import { isOk, newRequestId } from '@extro/node';
import type { ArkStatus } from '$lib/ark/ark-status.svelte';
import type { ExtroRuntimeConfig } from '$lib/extro/release-config';

/**
 * Read-only live-gate surface for the STAGING tier.
 *
 * Staging runs mainnet with the production trust set, so the dev debug hook
 * (`window.__extro`, a full client) must never be exposed there. Live gates
 * still need to prove what the served bundle did at boot. This surface gives
 * them exactly that and nothing else:
 *
 * - `ark()`: the boot-time Ark operator attestation result (canonical
 *   Op::Ark OperatorInfoDigest vs the release pin), as a plain snapshot.
 * - `probeKeyserver()`: pin the configured keyserver and verify its signed
 *   discovery record. Both use this deployment's runtime config only; no
 *   caller-supplied arguments, no identity, no rendezvous, no publish.
 *
 * There is no generic `send`: wallet, DHTX, swap and referee ops are not
 * reachable from here. Installed only when `deployment === 'staging'`;
 * development keeps its debug hook and production gets nothing.
 */
export interface GateSurface {
	readonly deployment: 'staging';
	ark(): ArkStatus;
	probeKeyserver(): Promise<KeyserverProbe>;
}

export interface KeyserverProbe {
	verified: boolean;
	fingerprint_hex: string;
	matches_pin: boolean;
}

export const GATE_SURFACE_GLOBAL = '__extroGate';

async function okBody(client: ExtroClient, op: Parameters<ExtroClient['send']>[0]['op'], kind: string) {
	const response = await client.send({ request_id: newRequestId(), op });
	if (!isOk(response)) throw new Error(`${response.code}: ${response.message}`);
	if (response.body.kind !== kind) throw new Error(`expected ${kind}, received ${response.body.kind}`);
	return response.body as Record<string, unknown>;
}

export function createGateSurface(
	client: ExtroClient,
	config: ExtroRuntimeConfig,
	status: ArkStatus
): GateSurface {
	return Object.freeze({
		deployment: 'staging' as const,
		ark: (): ArkStatus => ({
			ok: status.ok,
			reason: status.reason,
			receivedDigest: status.receivedDigest,
			expectedDigest: status.expectedDigest,
			attestation: status.attestation ? { ...status.attestation } : null
		}),
		probeKeyserver: async (): Promise<KeyserverProbe> => {
			await okBody(
				client,
				{
					kind: 'Keyserver',
					cmd: {
						op: 'Pin',
						base_url: config.keyserver_url,
						domain: config.keyserver_domain,
						fingerprint_hex: config.keyserver_fingerprint_hex,
						vk_hex: config.keyserver_vk_hex
					}
				},
				'KeyserverPinned'
			);
			const discovered = await okBody(
				client,
				{
					kind: 'Keyserver',
					cmd: { op: 'Discover', base_url: config.keyserver_url, domain: config.keyserver_domain }
				},
				'Discovered'
			);
			const fingerprint = String(discovered.fingerprint_hex ?? '');
			return {
				verified: discovered.verified === true,
				fingerprint_hex: fingerprint,
				matches_pin: fingerprint.toLowerCase() === config.keyserver_fingerprint_hex.toLowerCase()
			};
		}
	});
}

/** Install the surface on `target` iff this is the staging tier. Returns it, or null. */
export function installGateSurface(
	target: object,
	client: ExtroClient | null,
	config: ExtroRuntimeConfig,
	status: ArkStatus
): GateSurface | null {
	if (config.deployment !== 'staging' || !client) return null;
	const surface = createGateSurface(client, config, status);
	Object.defineProperty(target, GATE_SURFACE_GLOBAL, {
		value: surface,
		writable: false,
		configurable: false,
		enumerable: false
	});
	return surface;
}
