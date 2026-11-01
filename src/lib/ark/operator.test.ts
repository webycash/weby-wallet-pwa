import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ExtroRuntimeConfig } from '$lib/extro/release-config';
import { arkTxOpsVector, bootArkNode } from './ark-node.testkit';

const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));

import {
	arkOperatorWireInfo,
	attestConfiguredArkOperator,
	validateArkOperatorInfo,
	verifiedArkOperator
} from './operator';

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
	turn_servers: [],
	wallet_home_origin: 'https://wallet.test',
	connected_apps: [],
	grant_ttl_secs: 3600,
	legacy_wallet_origins: []
};

const info = {
	network: 'signet',
	signerPubkey: `02${signerXOnly}`,
	forfeitPubkey: `02${signerXOnly}`,
	forfeitAddress: 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c',
	boardingExitDelay: 172544n,
	dust: 330n,
	vtxoMinAmount: -1n,
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
		expect(attestation.operator).toEqual(arkOperatorWireInfo('signet', info));
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

describe('Ark operator canonical digest (extro-node Op::Ark)', () => {
	const v = arkTxOpsVector();
	const vectorInfo = {
		network: v.operator.network,
		signerPubkey: v.operator.signer_pubkey_hex,
		forfeitPubkey: v.operator.forfeit_pubkey_hex,
		forfeitAddress: v.operator.forfeit_address,
		checkpointTapscript: v.operator.checkpoint_tapscript_hex,
		unilateralExitDelay: BigInt(v.operator.unilateral_exit_delay),
		boardingExitDelay: BigInt(v.operator.boarding_exit_delay),
		dust: BigInt(v.operator.dust),
		vtxoMinAmount: BigInt(v.operator.vtxo_min_amount),
		// arkd's own digest is informational only and never compared.
		digest: '78'.repeat(32),
		version: 'test'
	};
	const regtest: ExtroRuntimeConfig = {
		...config,
		ark_network: 'regtest',
		ark_signer_pk_hex: v.operator_signer_pk_hex,
		ark_info_digest_hex: v.operator_info_digest_hex,
		ark_checkpoint_tapscript_hex: v.operator.checkpoint_tapscript_hex,
		ark_unilateral_exit_delay: v.exit_delay
	};
	const live = (over: Partial<typeof vectorInfo> = {}) => ({ getInfo: async () => ({ ...vectorInfo, ...over }) });

	beforeAll(async () => {
		node.client = await bootArkNode();
	});

	it('accepts the live operator whose canonical digest is the release pin', async () => {
		const att = await verifiedArkOperator(regtest, live());
		expect(att.operator.forfeit_address).toBe(v.operator.forfeit_address);
	});

	it('rejects a changed claim-relevant field under the same signer', async () => {
		await expect(verifiedArkOperator(regtest, live({ dust: 331n }))).rejects.toThrow(/info digest mismatch/);
		await expect(
			verifiedArkOperator(regtest, live({ forfeitPubkey: info.forfeitPubkey }))
		).rejects.toThrow(/info digest mismatch/);
	});
});
