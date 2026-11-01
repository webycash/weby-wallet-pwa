// Connected sites (ADR-0008): a connected site is this Extro identity signed
// in to that site. It stays connected until the user disconnects it — here,
// from the wallet on any of their devices, or from the site. The list syncs
// across the user's devices through the wallet home's relay
// (`${base}/api/connections`, @extro/node/connection-sync).

import { base } from '$app/paths';
import { ConnectionSyncError, syncConnections } from '@extro/node/connection-sync';
import { newRequestId, type Connection } from '@extro/node';
import { getExtroClient } from './index';
import { getRuntimeConfig } from './release-config';

export type SyncStatus = 'synced' | 'unavailable' | 'failed';

/** True on the wallet home (the origin connected sites sign in through). */
export function isWalletHome(origin: string = location.origin): boolean {
	try {
		return getRuntimeConfig().wallet_home_origin === origin;
	} catch {
		return false; // config not loaded: not serving as the home
	}
}

export function connectionSyncEndpoint(origin: string = location.origin): string {
	return `${origin}${base}/api/connections`;
}

/** Push this device's connections, pull the others', merge. Never throws. */
export async function syncNow(): Promise<SyncStatus> {
	if (!isWalletHome()) return 'unavailable';
	try {
		await syncConnections({ client: getExtroClient(), endpoint: connectionSyncEndpoint() });
		return 'synced';
	} catch (error) {
		if (error instanceof ConnectionSyncError && error.status === 501) return 'unavailable';
		console.warn('[connections] sync failed:', String(error));
		return 'failed';
	}
}

export async function listConnections(): Promise<Connection[]> {
	const res = await getExtroClient().send({ request_id: newRequestId(), op: { kind: 'Wallet', cmd: { op: 'ListConnections' } } });
	if (res.kind === 'Err') throw new Error(`${res.code}: ${res.message}`);
	if (res.body.kind !== 'Connections') throw new Error('unexpected ListConnections response');
	return res.body.items;
}

/** Disconnect a site on this device, then sync the disconnect to the others. */
export async function disconnect(id_hex: string): Promise<SyncStatus> {
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Wallet', cmd: { op: 'RevokeConnection', id_hex } }
	});
	if (res.kind === 'Err') throw new Error(`${res.code}: ${res.message}`);
	return syncNow();
}

/** The connections a user sees: one row per site, its live sign-in first. */
export function activeConnections(items: Connection[]): Connection[] {
	return items.filter((c) => c.revoked_at === null).sort((a, b) => b.connected_at - a.connected_at);
}
