import { describe, expect, it } from 'vitest';

import {
	allowedNetworkForDeployment,
	isProductionWebcashHost,
	NetworkRoutingError,
	resolveWebcashWasmNetwork
} from './webcash-routing';
import type { ExtroRuntimeConfig } from '$lib/extro/runtime-config';

const developmentConfig = (webcash_server_url: string): ExtroRuntimeConfig =>
	({
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
		webcash_server_url,
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
		turn_servers: []
	}) as ExtroRuntimeConfig;

describe('P0 webcash routing', () => {
	it('maps development deployment to testnet UI mode, not production', () => {
		expect(allowedNetworkForDeployment('development')).toBe('testnet');
		expect(allowedNetworkForDeployment('production')).toBe('production');
	});

	it('passes the configured development Webcash URL through to WASM', () => {
		const url = 'https://dev.weby.cash/api/webcash';
		expect(resolveWebcashWasmNetwork(developmentConfig(url))).toBe(url);
	});

	it('fail-closes when development selects production Webcash', () => {
		expect(() =>
			resolveWebcashWasmNetwork(developmentConfig('https://webcash.org'))
		).toThrowError(NetworkRoutingError);
		expect(() =>
			resolveWebcashWasmNetwork(developmentConfig('https://webcash.org'))
		).toThrow(/development_must_not_select_production_webcash/);
	});

	it('recognizes production Webcash hosts', () => {
		expect(isProductionWebcashHost('webcash.org')).toBe(true);
		expect(isProductionWebcashHost('api.webcash.org')).toBe(true);
		expect(isProductionWebcashHost('dev.weby.cash')).toBe(false);
	});

	it('rejects missing or non-http Webcash URLs with named errors', () => {
		expect(() => resolveWebcashWasmNetwork(developmentConfig(''))).toThrow(
			/missing_webcash_server_url/
		);
		expect(() =>
			resolveWebcashWasmNetwork(developmentConfig('ftp://dev.weby.cash/api/webcash'))
		).toThrow(/unsupported_webcash_server_url_scheme/);
	});
});
