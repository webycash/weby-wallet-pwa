import { describe, expect, it } from 'vitest';

import { ExtroClient, type ExtroAdapter } from './client';
import { joinExtroNetwork } from './connection';
import type { ExtroCommand, ExtroResponse, ResponseBody } from './commands';
import type { ExtroRuntimeConfig } from './runtime-config';

const config: ExtroRuntimeConfig = {
	schema_version: 1,
	deployment: 'development',
	db_name: 'test',
	adapter_mode: 'bundled',
	keyserver_url: 'https://dev.extro.network',
	keyserver_domain: 'dev.extro.network',
	keyserver_fingerprint_hex: '11'.repeat(20),
	keyserver_vk_hex: '22'.repeat(32),
	referee_url: 'https://dev.weby.cash/api/referee',
	referee_vk_hex: '33'.repeat(32),
	webcash_server_url: 'https://dev.weby.cash/api/webcash',
	voucher_server_url: 'https://dev.weby.cash/api/voucher',
	rgb_server_url: 'https://dev.weby.cash/api/rgb',
	rgb_collectible_server_url: 'https://dev.weby.cash/api/rgb-collectible',
	ark_enabled: false,
	ark_network: 'signet',
	ark_asp_url: '',
	ark_owner_pk_hex: '',
	zkp_profile: 'development-only',
	zkp_bearer_vk_sha256: '44'.repeat(32),
	zkp_conditional_vk_sha256: '55'.repeat(32),
	ice_servers: ['stun:stun.example.com:3478'],
	turn_servers: []
};

const ok = (command: ExtroCommand, body: ResponseBody): ExtroResponse => ({
	kind: 'Ok',
	request_id: command.request_id,
	body
});

class JoinAdapter implements ExtroAdapter {
	readonly mode = 'bundled' as const;
	readonly operations: string[] = [];
	constructor(private readonly discoveredFingerprint = config.keyserver_fingerprint_hex) {}
	async boot(): Promise<void> {}
	async dispatch(command: ExtroCommand): Promise<ExtroResponse> {
		const cmd = command.op.cmd;
		this.operations.push(cmd.op);
		switch (cmd.op) {
			case 'DeriveIdentity':
				return ok(command, {
					kind: 'Identity',
					fingerprint_hex: '66'.repeat(20),
					verifying_key: new Uint8Array(32),
					slot: 0
				});
			case 'Pin':
				return ok(command, { kind: 'KeyserverPinned' });
			case 'Discover':
				return ok(command, {
					kind: 'Discovered',
					fingerprint_hex: this.discoveredFingerprint,
					verified: true
				});
			case 'Bootstrap':
				return ok(command, {
					kind: 'Bootstrapped',
					roster_count: 2,
					dhtx_seeds_count: 1,
					interest_seeds_count: 0,
					peers_connected: 1,
					connected: true
				});
			default:
				throw new Error(`unexpected ${cmd.op}`);
		}
	}
}

describe('Extro production bootstrap sequence', () => {
	it('derives, pins, verifies discovery, then opens the DataChannel', async () => {
		const adapter = new JoinAdapter();
		const connected = await joinExtroNetwork(new ExtroClient(adapter), config, { delaysMs: [0] });
		expect(connected).toBe(true);
		expect(adapter.operations).toEqual(['DeriveIdentity', 'Pin', 'Discover', 'Bootstrap']);
	});

	it('fails closed when discovery does not match the configured pin', async () => {
		const adapter = new JoinAdapter('aa'.repeat(20));
		const connected = await joinExtroNetwork(new ExtroClient(adapter), config, { delaysMs: [0] });
		expect(connected).toBe(false);
		expect(adapter.operations).toEqual(['DeriveIdentity', 'Pin', 'Discover']);
	});
});
