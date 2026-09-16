import { describe, expect, it } from 'vitest';

import type { ExtroRuntimeConfig } from '$lib/extro/runtime-config';

import { attestConfiguredArkOperator, validateArkOperatorInfo } from './operator';

const signerXOnly = '8bf56160efc769112b361de4117b3c71b88ca16f1bb9f6ac7a2781929abc5e6a';
const infoDigest = '66'.repeat(32);
const checkpointTapscript = '03a80040b27520' + '77'.repeat(32) + 'ac';

const config: ExtroRuntimeConfig = {
	schema_version: 2,
	deployment: 'development',
	db_name: 'ark-test',
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
	ark_signer_pk_hex: signerXOnly,
	ark_info_digest_hex: infoDigest,
	ark_checkpoint_tapscript_hex: checkpointTapscript,
	ark_unilateral_exit_delay: 172544,
	zkp_profile: 'development-only',
	zkp_bearer_vk_sha256: '44'.repeat(32),
	zkp_conditional_vk_sha256: '55'.repeat(32),
	ice_servers: ['stun:stun.cloudflare.com:3478'],
	turn_servers: []
};

const info = {
	network: 'signet',
	signerPubkey: `02${signerXOnly}`,
	digest: infoDigest,
	checkpointTapscript,
	unilateralExitDelay: 172544n,
	version: 'test'
};

describe('Ark operator release attestation', () => {
	it('accepts a live info document only when network and signer match the release pins', () => {
		const attestation = validateArkOperatorInfo(config, info);
		expect(attestation.signer_pk_hex).toBe(signerXOnly);
		expect(attestation.network).toBe('signet');
		expect(attestation.unilateral_exit_delay).toBe(172544n);
	});

	it('rejects a substituted operator key', () => {
		expect(() =>
			validateArkOperatorInfo(config, {
				...info,
				signerPubkey: `03${'99'.repeat(32)}`
			})
		).toThrow(/signer mismatch/);
	});

	it('rejects a cross-network operator', () => {
		expect(() => validateArkOperatorInfo(config, { ...info, network: 'bitcoin' })).toThrow(
			/network mismatch/
		);
	});

	it('rejects changed operator policy under the same signer', () => {
		expect(() => validateArkOperatorInfo(config, { ...info, digest: '78'.repeat(32) })).toThrow(
			/info digest mismatch/
		);
		expect(() =>
			validateArkOperatorInfo(config, { ...info, checkpointTapscript: '79'.repeat(32) })
		).toThrow(/checkpointTapscript does not match/);
		expect(() => validateArkOperatorInfo(config, { ...info, unilateralExitDelay: 1n })).toThrow(
			/unilateralExitDelay mismatch/
		);
	});

	it('does not contact an operator when Ark is disabled', async () => {
		let called = false;
		const disabled = {
			...config,
			ark_enabled: false,
			ark_asp_url: '',
			ark_signer_pk_hex: '',
			ark_info_digest_hex: '',
			ark_checkpoint_tapscript_hex: '',
			ark_unilateral_exit_delay: 0
		};
		const result = await attestConfiguredArkOperator(disabled, {
			async getInfo() {
				called = true;
				return info;
			}
		});
		expect(result).toBeNull();
		expect(called).toBe(false);
	});
});
