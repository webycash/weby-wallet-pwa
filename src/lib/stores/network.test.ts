import { afterEach, describe, expect, it } from 'vitest';

import {
	parseRuntimeConfig,
	resetRuntimeConfigForTests,
	setRuntimeConfigForTests
} from '$lib/extro/runtime-config';
import { NetworkRoutingError } from '$lib/core/webcash-routing';
import {
	getNetwork,
	setNetwork,
	syncNetworkFromRuntimeConfig
} from './network.svelte';

const development = () => ({
	schema_version: 2,
	deployment: 'development',
	db_name: 'extro-node-test',
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
	ark_signer_pk_hex: '',
	ark_info_digest_hex: '',
	ark_checkpoint_tapscript_hex: '',
	ark_unilateral_exit_delay: 0,
	zkp_profile: 'development-only',
	zkp_bearer_vk_sha256: 'ecd299b3326e682106a31a39decf1fb43c0d5b960eb40baa2975691f406f77c1',
	zkp_conditional_vk_sha256: '8efdd75f738658f3da0308fac3cbf6912c1324e815d863548c7e82ba39d07f1d',
	ice_servers: ['stun:stun.cloudflare.com:3478'],
	turn_servers: [
		{
			url: 'turn:openrelay.metered.ca:443',
			username: 'openrelayproject',
			credential: 'openrelayproject'
		}
	]
});

describe('P0 network store defaults', () => {
	afterEach(() => {
		resetRuntimeConfigForTests();
		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem('weby_network_mode');
		}
	});

	it('fresh profile under development does not default to production', () => {
		setRuntimeConfigForTests(parseRuntimeConfig(development()));

		const memory = new Map<string, string>();
		(globalThis as unknown as { localStorage: Storage }).localStorage = {
			getItem: (k: string) => memory.get(k) ?? null,
			setItem: (k: string, v: string) => {
				memory.set(k, v);
			},
			removeItem: (k: string) => {
				memory.delete(k);
			},
			clear: () => memory.clear(),
			key: () => null,
			length: 0
		};

		expect(syncNetworkFromRuntimeConfig()).toBe('testnet');
		expect(getNetwork()).toBe('testnet');
		expect(memory.get('weby_network_mode')).toBe('testnet');
		expect(() => setNetwork('production')).toThrowError(NetworkRoutingError);
		expect(() => setNetwork('production')).toThrow(/set_network_prohibited/);
	});

	it('fail-closes when stored production conflicts with development config', () => {
		setRuntimeConfigForTests(parseRuntimeConfig(development()));
		const memory = new Map<string, string>([['weby_network_mode', 'production']]);
		(globalThis as unknown as { localStorage: Storage }).localStorage = {
			getItem: (k: string) => memory.get(k) ?? null,
			setItem: (k: string, v: string) => {
				memory.set(k, v);
			},
			removeItem: (k: string) => {
				memory.delete(k);
			},
			clear: () => memory.clear(),
			key: () => null,
			length: 0
		};
		expect(() => getNetwork()).toThrow(/weby_network_mode_prohibited/);
	});
});
