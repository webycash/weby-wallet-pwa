// refereeFromConfig (ark-swap-protocol) is the one place the swap protocol
// builds its referee client. A tier without a referee must stop at the named
// REFEREE_UNAVAILABLE gate, never build a client for an empty URL.
import { afterEach, describe, expect, it } from 'vitest';
import {
	parseRuntimeConfig,
	resetRuntimeConfigForTests,
	setRuntimeConfigForTests
} from '$lib/extro/release-config';
import { GATE_REFEREE_UNAVAILABLE, isNamedArkGateError } from '$lib/ark/named-gates';
import { refereeFromConfig } from './ark-swap-protocol';

const development = (referee_url: string, referee_vk_hex: string) => ({
	schema_version: 2,
	deployment: 'development',
	db_name: 'extro-node-test',
	adapter_mode: 'bundled',
	keyserver_url: 'https://dev.extro.network',
	keyserver_domain: 'dev.extro.network',
	keyserver_fingerprint_hex: '11'.repeat(20),
	keyserver_vk_hex: '22'.repeat(32),
	referee_url,
	referee_vk_hex,
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
	turn_servers: [],
	wallet_home_origin: 'https://wallet.test',
	connected_apps: [],
	grant_ttl_secs: 3600
});

afterEach(() => resetRuntimeConfigForTests());

describe('refereeFromConfig', () => {
	it('throws GATE_REFEREE_UNAVAILABLE when the tier has no referee', () => {
		setRuntimeConfigForTests(parseRuntimeConfig(development('', '')));
		let err: unknown;
		try {
			refereeFromConfig();
		} catch (e) {
			err = e;
		}
		expect(isNamedArkGateError(err) && err.gate).toBe(GATE_REFEREE_UNAVAILABLE);
	});

	it('builds the pinned client when a referee is configured', () => {
		setRuntimeConfigForTests(parseRuntimeConfig(development('https://dev.weby.cash/api/referee', '33'.repeat(32))));
		const r = refereeFromConfig();
		expect(r.refereeVk).toEqual(new Uint8Array(32).fill(0x33));
		expect(r.referee).toBeDefined();
	});
});
