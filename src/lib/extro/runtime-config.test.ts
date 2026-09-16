import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from './runtime-config';

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

describe('strict runtime configuration', () => {
	it('accepts the explicit development schema', () => {
		expect(parseRuntimeConfig(development()).deployment).toBe('development');
	});

	it('names missing and unknown fields', () => {
		const missing = development();
		delete (missing as Partial<typeof missing>).referee_vk_hex;
		expect(() => parseRuntimeConfig(missing)).toThrow('missing field `referee_vk_hex`');
		expect(() => parseRuntimeConfig({ ...development(), surprise: true })).toThrow(
			'unknown field `surprise`'
		);
	});

	it('rejects mock adapters and zero pins', () => {
		expect(() => parseRuntimeConfig({ ...development(), adapter_mode: 'mock' })).toThrow(
			'adapter_mode must be `bundled`'
		);
		expect(() =>
			parseRuntimeConfig({
				...development(),
				keyserver_vk_hex: '0'.repeat(64)
			})
		).toThrow('must not be all zero');
	});

	it('rejects dormant Ark trust material when Ark is disabled', () => {
		expect(() =>
			parseRuntimeConfig({ ...development(), ark_info_digest_hex: '44'.repeat(32) })
		).toThrow('Ark trust fields must be empty/zero');
	});

	it('rejects dev ceremony and public TURN in production', () => {
		const production = {
			...development(),
			deployment: 'production',
			ark_enabled: true,
			ark_network: 'bitcoin',
			ark_asp_url: 'https://ark.example.com',
			ark_signer_pk_hex: '44'.repeat(32),
			ark_info_digest_hex: '45'.repeat(32),
			ark_checkpoint_tapscript_hex: '46'.repeat(32),
			ark_unilateral_exit_delay: 605184
		};
		expect(() => parseRuntimeConfig(production)).toThrow('development-only ZKP');

		production.zkp_profile = 'mpc-2026';
		production.zkp_bearer_vk_sha256 = '55'.repeat(32);
		production.zkp_conditional_vk_sha256 = '66'.repeat(32);
		expect(() => parseRuntimeConfig(production)).toThrow('Open Relay');
	});

	it('rejects localhost and non-HTTPS production endpoints', () => {
		const production = {
			...development(),
			deployment: 'production',
			keyserver_url: 'http://localhost:7800',
			keyserver_domain: 'localhost',
			ark_enabled: true,
			ark_network: 'bitcoin',
			ark_asp_url: 'https://ark.example.com',
			ark_signer_pk_hex: '44'.repeat(32),
			ark_info_digest_hex: '45'.repeat(32),
			ark_checkpoint_tapscript_hex: '46'.repeat(32),
			ark_unilateral_exit_delay: 605184,
			zkp_profile: 'mpc-2026',
			zkp_bearer_vk_sha256: '55'.repeat(32),
			zkp_conditional_vk_sha256: '66'.repeat(32),
			turn_servers: [
				{
					url: 'turns:turn.example.com:443',
					username: 'short',
					credential: 'lived'
				}
			]
		};
		expect(() => parseRuntimeConfig(production)).toThrow('must use https in production');
	});
});
