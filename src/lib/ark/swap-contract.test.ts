/**
 * The swap contract is built by the real extro-node WASM (`Op::Ark
 * SwapContract`), pinned to the cross-backend vector extro-node ships
 * (`@extro/node/vectors/ark_tx_ops.json`); the SDK only decodes its taptree.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExtroRuntimeConfig } from '$lib/extro/release-config';
import { arkTxOpsVector, bootArkNode } from './ark-node.testkit';

const node = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/extro', () => ({ getExtroClient: () => node.client }));

import {
	WEBYCASH_ARK_CONTRACT_TYPE,
	buildArkSwapContract,
	confirmArkSwapFunding,
	fundArkSwapContract,
	registerArkSwapContract,
	type VerifiedArkContractPlan
} from './swap-contract';
import { arkOperatorInfoDigest } from './operator';
import { fundingRefsFromSpends } from './settle-tx';

const hex = (value: string): Uint8Array =>
	Uint8Array.from({ length: value.length / 2 }, (_, i) => Number.parseInt(value.slice(i * 2, i * 2 + 2), 16));
const hx = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const v = arkTxOpsVector();

const plan = (overrides: Partial<VerifiedArkContractPlan> = {}): VerifiedArkContractPlan => ({
	swapId: v.swap_id,
	requestCommitment: hex(v.request_commitment_hex),
	refereePubkeyHex: v.referee_pubkey_hex,
	providerPubkeyHex: v.provider_pubkey_hex,
	aggregateOwnerKey: hex(v.owner_q_hex),
	providerRecoveryKey: hex(v.provider_pubkey_hex.slice(2)),
	operatorSignerKey: hex(v.operator_signer_pk_hex),
	operatorInfoDigest: hex(v.operator_info_digest_hex),
	unilateralExitDelay: BigInt(v.exit_delay),
	amountSats: BigInt(v.amount_sats),
	network: 'regtest',
	providerDestination: v.refund_destination,
	bearerSellerDestination: v.settle_destination,
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
	ark_network: 'regtest',
	ark_asp_url: 'https://ark.example',
	ark_signer_pk_hex: v.operator_signer_pk_hex,
	ark_info_digest_hex: v.operator_info_digest_hex,
	ark_checkpoint_tapscript_hex: v.operator.checkpoint_tapscript_hex,
	ark_unilateral_exit_delay: v.exit_delay,
	zkp_profile: 'test',
	zkp_bearer_vk_sha256: '18'.repeat(32),
	zkp_conditional_vk_sha256: '19'.repeat(32),
	ice_servers: [],
	turn_servers: [],
	wallet_home_origin: 'https://wallet.test',
	connected_apps: [],
	legacy_wallet_origins: []
};

const build = (p = plan(), c = config, operator = v.operator) => buildArkSwapContract(c, p, operator, 1n);

beforeAll(async () => {
	node.client = await bootArkNode();
});

describe('WebyCash Ark contract (extro-node Op::Ark)', () => {
	it('canonical operator digest equals the vector pin', async () => {
		await expect(arkOperatorInfoDigest(v.operator)).resolves.toBe(v.operator_info_digest_hex);
	});

	it('builds the canonical 2-leaf contract of the vector; the SDK decodes it identically', async () => {
		const first = await build();
		expect(first.address).toBe(v.address);
		expect(first.pkScriptHex).toBe(v.script_pubkey_hex);
		expect(hx(first.tapTree)).toBe(v.tap_tree_hex);
		expect(hx(first.script.pkScript)).toBe(v.script_pubkey_hex);
		expect(first.script.scripts.map(hx)).toEqual([v.forfeit_script_hex, v.recovery_script_hex]);
		expect(first.script.scripts.some((leaf) => leaf[0] === 0x6a)).toBe(false);
		expect(first.contract.type).toBe(WEBYCASH_ARK_CONTRACT_TYPE);
		expect(first.operator).toBe(v.operator);
		// Q is per-swap (C1): another swap id never reuses the plan's owner key.
		await expect(build(plan({ swapId: 'swap-e2e-other' }))).rejects.toThrow(/owner key/);
	});

	it('SwapClaims sighash bundles equal the vector', async () => {
		const refs = await fundingRefsFromSpends(await build(), v.locked_ref);
		expect(refs.txSettleHashHex).toBe(v.settle_bundle_hex);
		expect(refs.txRefundHashHex).toBe(v.refund_bundle_hex);
	});

	it('fails closed on a foreign Q, mutable operator facts and runtime pin drift', async () => {
		await expect(build(plan({ aggregateOwnerKey: new Uint8Array(32).fill(7) }))).rejects.toThrow(/owner key/);
		await expect(build(plan(), config, { ...v.operator, dust: 331 })).rejects.toThrow(/operator info digest/);
		await expect(build(plan({ amountSats: 0n }))).rejects.toThrow(/amount/);
		await expect(build(plan({ operatorInfoDigest: new Uint8Array(32).fill(9) }))).rejects.toThrow(/digest/);
		await expect(build(plan({ expiresAtUnix: 1n }))).rejects.toThrow(/expired/);
		await expect(
			build(plan({ unilateralExitDelay: 1025n }), { ...config, ark_unilateral_exit_delay: 1025 })
		).rejects.toThrow();
	});

	it('registers the non-generic contract and funds with its exact tap tree', async () => {
		const value = await build();
		const createContract = vi.fn(async (contract) => ({ ...contract, createdAt: 1 }));
		await registerArkSwapContract({ createContract }, value);
		expect(createContract).toHaveBeenCalledWith(value.contract);

		const send = vi.fn(async () => 'ab'.repeat(32));
		const funded = await fundArkSwapContract({ send }, value);
		expect(funded.arkTxId).toBe('ab'.repeat(32));
		expect(send).toHaveBeenCalledWith({
			recipients: [{ address: value.address, amount: v.amount_sats, tapTree: value.tapTree }]
		});
	});

	it('re-reads the exact unspent amount before the prover can use locked_ref', async () => {
		const value = await build();
		const lockedRef = `${'cd'.repeat(32)}:2`;
		const refreshVtxos = vi.fn(async () => undefined);
		const getContractsWithVtxos = vi.fn(async () => [
			{
				contract: { ...value.contract, createdAt: 1 },
				vtxos: [
					{
						txid: 'cd'.repeat(32),
						vout: 2,
						value: v.amount_sats,
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
		expect(evidence.amountSats).toBe(BigInt(v.amount_sats));
		expect(refreshVtxos).toHaveBeenCalledWith({ scripts: [value.pkScriptHex] });
	});
});
