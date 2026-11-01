import { beforeEach, describe, expect, it, vi } from 'vitest';

import { arkStatus } from './ark-status.svelte';
import { bootWithArkAttestation, type ArkBootSteps } from './boot-attestation';
import type { ArkOperatorAttestation } from './operator';
import {
	getRuntimeConfig,
	resetRuntimeConfigForTests,
	setRuntimeConfigForTests,
	type ExtroRuntimeConfig
} from '$lib/extro/release-config';

const PIN = 'a9'.repeat(32);
const OTHER = '6f'.repeat(32);

const loaded = {
	schema_version: 2,
	deployment: 'development',
	db_name: 'boot-test',
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
	ark_enabled: true,
	ark_network: 'signet',
	ark_asp_url: 'https://signet.arkade.sh',
	ark_signer_pk_hex: '8b'.repeat(32),
	ark_info_digest_hex: PIN,
	ark_checkpoint_tapscript_hex: '03a80040b27520' + '77'.repeat(32) + 'ac',
	ark_unilateral_exit_delay: 172544,
	zkp_profile: 'development-only',
	zkp_bearer_vk_sha256: '44'.repeat(32),
	zkp_conditional_vk_sha256: '55'.repeat(32),
	ice_servers: ['stun:stun.cloudflare.com:3478'],
	turn_servers: [],
	hub_bridge_origins: []
} satisfies ExtroRuntimeConfig as ExtroRuntimeConfig;

const att = {
	url: loaded.ark_asp_url,
	network: 'signet',
	signer_pk_hex: loaded.ark_signer_pk_hex,
	info_digest: OTHER, // arkd's own GetInfo.digest — never the pin
	unilateral_exit_delay: 172544n
} as unknown as ArkOperatorAttestation;

function steps(over: Partial<ArkBootSteps> = {}): ArkBootSteps {
	return { attest: async () => att, verifyDigest: async () => att, ...over };
}

describe('boot-time Ark operator attestation', () => {
	beforeEach(() => {
		resetRuntimeConfigForTests();
		setRuntimeConfigForTests(loaded);
		Object.assign(arkStatus, { ok: null, reason: null, receivedDigest: null, expectedDigest: null, attestation: null });
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('boots with pins, then checks the canonical digest through the booted node', async () => {
		const order: string[] = [];
		const config = await bootWithArkAttestation(
			loaded,
			(c) => order.push(`boot:${c.ark_enabled}`),
			steps({
				attest: async () => (order.push('pins'), att),
				verifyDigest: async () => (order.push('digest'), att)
			})
		);
		expect(order).toEqual(['pins', 'boot:true', 'digest']);
		expect(config.ark_enabled).toBe(true);
		expect(arkStatus.ok).toBe(true);
		expect(arkStatus.attestation?.info_digest).toBe(PIN);
	});

	it('a canonical digest mismatch disables Ark for the session (fail-soft)', async () => {
		const boots: boolean[] = [];
		const config = await bootWithArkAttestation(
			loaded,
			(c) => boots.push(c.ark_enabled),
			steps({
				verifyDigest: async () => {
					throw new Error(`info digest mismatch: expected ${PIN}, received ${OTHER}`);
				}
			})
		);
		expect(boots).toEqual([true]);
		expect(config.ark_enabled).toBe(false);
		expect(getRuntimeConfig().ark_enabled).toBe(false);
		expect(getRuntimeConfig().ark_info_digest_hex).toBe('');
		expect(arkStatus).toMatchObject({ ok: false, receivedDigest: OTHER, expectedDigest: PIN, attestation: null });
	});

	it('a release-pin mismatch boots the node with Ark disabled and never asks for the digest', async () => {
		const boots: boolean[] = [];
		const verifyDigest = vi.fn(async () => att);
		const config = await bootWithArkAttestation(
			loaded,
			(c) => boots.push(c.ark_enabled),
			steps({
				attest: async () => {
					throw new Error('signer mismatch');
				},
				verifyDigest
			})
		);
		expect(boots).toEqual([false]);
		expect(config.ark_enabled).toBe(false);
		expect(verifyDigest).not.toHaveBeenCalled();
		expect(arkStatus).toMatchObject({ ok: false, reason: 'signer mismatch' });
	});

	it('Ark disabled in configuration boots as-is without touching the operator', async () => {
		const off = { ...loaded, ark_enabled: false } as ExtroRuntimeConfig;
		const attest = vi.fn(async () => att);
		const boots: boolean[] = [];
		await bootWithArkAttestation(off, (c) => boots.push(c.ark_enabled), steps({ attest }));
		expect(boots).toEqual([false]);
		expect(attest).not.toHaveBeenCalled();
		expect(arkStatus.ok).toBe(false);
	});
});
