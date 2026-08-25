import { describe, expect, it, vi } from 'vitest';
import type { ExtroRuntimeConfig } from '$lib/extro/runtime-config';
import {
	WEBYCASH_ARK_CONTRACT_TYPE,
	buildArkSwapContract,
	confirmArkSwapFunding,
	fundArkSwapContract,
	registerArkSwapContract,
	type VerifiedArkContractPlan
} from './swap-contract';

const hex = (value: string): Uint8Array =>
	Uint8Array.from({ length: value.length / 2 }, (_, i) => Number.parseInt(value.slice(i * 2, i * 2 + 2), 16));

const plan = (overrides: Partial<VerifiedArkContractPlan> = {}): VerifiedArkContractPlan => ({
	swapId: 'swap-contract-fixture',
	requestCommitment: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
	aggregateOwnerKey: hex('f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'),
	providerRecoveryKey: hex('c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'),
	operatorSignerKey: hex('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
	operatorInfoDigest: new Uint8Array(32).fill(0x62),
	unilateralExitDelay: 86_016n,
	amountSats: 25_000n,
	network: 'signet',
	providerDestination: 'tark1provider',
	bearerSellerDestination: 'tark1seller',
	expiresAtUnix: 4_000_000_000n,
	...overrides
});

const config: ExtroRuntimeConfig = {
	schema_version: 2,
	deployment: 'development',
	db_name: 'test',
	adapter_mode: 'bundled',
	keyserver_url: 'https://key.example',
	keyserver_domain: 'key.example',
	keyserver_fingerprint_hex: '11'.repeat(20),
	keyserver_vk_hex: '12'.repeat(32),
	referee_url: 'https://referee.example',
	referee_vk_hex: '13'.repeat(32),
	webcash_server_url: 'https://webcash.example',
	voucher_server_url: 'https://voucher.example',
	rgb_server_url: 'https://rgb.example',
	rgb_collectible_server_url: 'https://rgb21.example',
	ark_enabled: true,
	ark_network: 'signet',
	ark_asp_url: 'https://ark.example',
	ark_signer_pk_hex: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
	ark_info_digest_hex: '62'.repeat(32),
	ark_checkpoint_tapscript_hex: '63'.repeat(32),
	ark_unilateral_exit_delay: 86_016,
	zkp_profile: 'test',
	zkp_bearer_vk_sha256: '18'.repeat(32),
	zkp_conditional_vk_sha256: '19'.repeat(32),
	ice_servers: [],
	turn_servers: []
};

describe('WebyCash Ark contract', () => {
	it('derives a deterministic request-unique contract with a recovery leaf', () => {
		const first = buildArkSwapContract(config, plan(), 1n);
		const same = buildArkSwapContract(config, plan(), 1n);
		const other = buildArkSwapContract(
			config,
			plan({ requestCommitment: new Uint8Array(32).fill(0x7a) }),
			1n
		);
		expect(first.address).toBe(same.address);
		expect(first.pkScriptHex).toBe(same.pkScriptHex);
		expect(first.address).not.toBe(other.address);
		expect(first.script.scripts).toHaveLength(3);
		expect(first.script.scripts.some((leaf) => leaf[0] === 0x6a)).toBe(true);
		expect(first.contract.type).toBe(WEBYCASH_ARK_CONTRACT_TYPE);
	});

	it('fails closed on mutable operator facts and unsafe delay encoding', () => {
		expect(() => buildArkSwapContract(config, plan({ amountSats: 0n }), 1n)).toThrow(
			/amount/
		);
		expect(() =>
			buildArkSwapContract(config, plan({ operatorInfoDigest: new Uint8Array(32).fill(9) }), 1n)
		).toThrow(/digest/);
		expect(() =>
			buildArkSwapContract(
				{ ...config, ark_unilateral_exit_delay: 86_017 },
				plan({ unilateralExitDelay: 86_017n }),
				1n
			)
		).toThrow(/multiple of 512/);
	});

	it('registers the non-generic contract and funds with its exact tap tree', async () => {
		const value = buildArkSwapContract(config, plan(), 1n);
		const createContract = vi.fn(async (contract) => ({ ...contract, createdAt: 1 }));
		await registerArkSwapContract({ createContract }, value);
		expect(createContract).toHaveBeenCalledWith(value.contract);

		const send = vi.fn(async () => 'ab'.repeat(32));
		const funded = await fundArkSwapContract({ send }, value);
		expect(funded.arkTxId).toBe('ab'.repeat(32));
		expect(send).toHaveBeenCalledWith({
			recipients: [{ address: value.address, amount: 25_000, tapTree: value.tapTree }]
		});
	});

	it('re-reads the exact unspent amount before the prover can use locked_ref', async () => {
		const value = buildArkSwapContract(config, plan(), 1n);
		const lockedRef = `${'cd'.repeat(32)}:2`;
		const refreshVtxos = vi.fn(async () => undefined);
		const getContractsWithVtxos = vi.fn(async () => [
			{
				contract: { ...value.contract, createdAt: 1 },
				vtxos: [
					{
						txid: 'cd'.repeat(32),
						vout: 2,
						value: 25_000,
						status: { confirmed: true, blockHeight: 1, blockHash: '00', blockTime: 1 },
						createdAt: new Date(1),
						script: value.pkScriptHex,
						isUnrolled: false,
						isSpent: false,
						isSwept: false,
						isPreconfirmed: false,
						spentBy: '',
						commitmentTxIds: [],
						virtualStatus: { state: 'settled' as const },
						forfeitTapLeafScript: [
							{ version: 0xc0, internalKey: new Uint8Array(32), merklePath: [] },
							new Uint8Array()
						] as [
							{ version: number; internalKey: Uint8Array; merklePath: Uint8Array[] },
							Uint8Array
						],
						intentTapLeafScript: [
							{ version: 0xc0, internalKey: new Uint8Array(32), merklePath: [] },
							new Uint8Array()
						] as [
							{ version: number; internalKey: Uint8Array; merklePath: Uint8Array[] },
							Uint8Array
						],
						tapTree: value.tapTree,
						contractScript: value.pkScriptHex
					}
				]
			}
		]);
		const evidence = await confirmArkSwapFunding(
			{ refreshVtxos, getContractsWithVtxos },
			value,
			lockedRef
		);
		expect(evidence.lockedRef).toBe(lockedRef);
		expect(evidence.amountSats).toBe(25_000n);
		expect(refreshVtxos).toHaveBeenCalledWith({ scripts: [value.pkScriptHex] });
	});
});
