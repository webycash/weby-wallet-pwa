import { writable } from 'svelte/store';

import type { ExtroClient } from './client';
import { isOk, newRequestId, type ResponseBody } from './commands';
import type { ExtroRuntimeConfig } from './runtime-config';

export type ExtroConnectionPhase =
	| 'idle'
	| 'deriving-identity'
	| 'pinning'
	| 'discovering'
	| 'connecting'
	| 'connected'
	| 'disconnected'
	| 'error';

export interface ExtroConnectionState {
	phase: ExtroConnectionPhase;
	message: string;
	connected: boolean;
	attempt: number;
	updated_at: string;
	roster_count: number;
	peers_connected: number;
	dhtx_seeds_count: number;
}

const emptyState = (): ExtroConnectionState => ({
	phase: 'idle',
	message: '',
	connected: false,
	attempt: 0,
	updated_at: new Date(0).toISOString(),
	roster_count: 0,
	peers_connected: 0,
	dhtx_seeds_count: 0
});

export const extroConnection = writable<ExtroConnectionState>(emptyState());

let currentClient: ExtroClient | null = null;
let currentConfig: ExtroRuntimeConfig | null = null;
let reconnectInstalled = false;
let joinPromise: Promise<boolean> | null = null;

function record(next: Partial<ExtroConnectionState>): void {
	extroConnection.update((previous) => {
		const state = { ...previous, ...next, updated_at: new Date().toISOString() };
		if (typeof localStorage !== 'undefined') {
			try {
				// Redacted observability only: never persist SDP, ICE credentials,
				// identities, seeds, signatures, or endpoint response bodies.
				localStorage.setItem('extro_connection_status_v1', JSON.stringify(state));
			} catch {
				// Storage can be unavailable in private browsing. Connection remains live.
			}
		}
		return state;
	});
}

async function expectBody<K extends ResponseBody['kind']>(
	client: ExtroClient,
	cmd: Parameters<ExtroClient['send']>[0],
	kind: K
): Promise<Extract<ResponseBody, { kind: K }>> {
	const response = await client.send(cmd);
	if (!isOk(response)) throw new Error(`${response.code}: ${response.message}`);
	if (response.body.kind !== kind) {
		throw new Error(`expected ${kind}, received ${response.body.kind}`);
	}
	return response.body as Extract<ResponseBody, { kind: K }>;
}

async function connectOnce(
	client: ExtroClient,
	config: ExtroRuntimeConfig,
	attempt: number
): Promise<boolean> {
	record({ phase: 'pinning', message: 'Pinning the Extro trust anchor', attempt, connected: false });
	await expectBody(
		client,
		{
			request_id: newRequestId(),
			op: {
				kind: 'Keyserver',
				cmd: {
					op: 'Pin',
					base_url: config.keyserver_url,
					domain: config.keyserver_domain,
					fingerprint_hex: config.keyserver_fingerprint_hex,
					vk_hex: config.keyserver_vk_hex
				}
			}
		},
		'KeyserverPinned'
	);

	record({ phase: 'discovering', message: 'Verifying the keyserver discovery record', attempt });
	const discovered = await expectBody(
		client,
		{
			request_id: newRequestId(),
			op: {
				kind: 'Keyserver',
				cmd: {
					op: 'Discover',
					base_url: config.keyserver_url,
					domain: config.keyserver_domain
				}
			}
		},
		'Discovered'
	);
	if (!discovered.verified) throw new Error('keyserver discovery signature is not verified');
	if (discovered.fingerprint_hex.toLowerCase() !== config.keyserver_fingerprint_hex.toLowerCase()) {
		throw new Error(
			`keyserver fingerprint mismatch: expected ${config.keyserver_fingerprint_hex}, received ${discovered.fingerprint_hex}`
		);
	}

	record({ phase: 'connecting', message: 'Opening the Extro DataChannel', attempt });
	const joined = await expectBody(
		client,
		{
			request_id: newRequestId(),
			op: {
				kind: 'Keyserver',
				cmd: {
					op: 'Bootstrap',
					base_url: config.keyserver_url,
					domain: config.keyserver_domain
				}
			}
		},
		'Bootstrapped'
	);
	if (!joined.connected) throw new Error('bootstrap completed without an open keyserver DataChannel');
	record({
		phase: 'connected',
		message: 'Connected to Extro',
		connected: true,
		attempt,
		roster_count: joined.roster_count,
		peers_connected: joined.peers_connected,
		dhtx_seeds_count: joined.dhtx_seeds_count
	});
	return true;
}

/** Derive the slot-0 identity once, then pin/discover/bootstrap with bounded retries. */
export async function joinExtroNetwork(
	client: ExtroClient,
	config: ExtroRuntimeConfig,
	options: { deriveIdentity?: boolean; delaysMs?: number[] } = {}
): Promise<boolean> {
	currentClient = client;
	currentConfig = config;
	if (joinPromise) return joinPromise;
	joinPromise = (async () => {
		try {
			if (options.deriveIdentity !== false) {
				record({
					phase: 'deriving-identity',
					message: 'Deriving the Extro identity',
					connected: false,
					attempt: 0
				});
				await expectBody(
					client,
					{
						request_id: newRequestId(),
						op: { kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot: 0 } }
					},
					'Identity'
				);
			}

			const delays = options.delaysMs ?? [0, 750, 2500];
			let lastError: unknown = new Error('no bootstrap attempt was configured');
			for (let index = 0; index < delays.length; index += 1) {
				if (delays[index] > 0) await new Promise((resolve) => setTimeout(resolve, delays[index]));
				try {
					const connected = await connectOnce(client, config, index + 1);
					installReconnectListeners();
					return connected;
				} catch (error) {
					lastError = error;
					record({
						phase: index + 1 === delays.length ? 'error' : 'disconnected',
						message: String(error instanceof Error ? error.message : error),
						connected: false,
						attempt: index + 1
					});
				}
			}
			throw lastError;
		} catch (error) {
			record({
				phase: 'error',
				message: String(error instanceof Error ? error.message : error),
				connected: false
			});
			return false;
		} finally {
			joinPromise = null;
		}
	})();
	return joinPromise;
}

function installReconnectListeners(): void {
	if (reconnectInstalled || typeof window === 'undefined') return;
	reconnectInstalled = true;
	const reconnect = () => {
		if (!currentClient || !currentConfig || !navigator.onLine) return;
		void joinExtroNetwork(currentClient, currentConfig, {
			deriveIdentity: false,
			delaysMs: [0, 1000, 4000]
		});
	};
	window.addEventListener('online', reconnect);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') reconnect();
	});
}

export function markExtroDisconnected(message = 'Wallet locked'): void {
	currentClient = null;
	currentConfig = null;
	record({ phase: 'disconnected', message, connected: false, attempt: 0 });
}
