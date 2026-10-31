/**
 * TEST-ONLY Ark swap contract over deterministic, never-funded scalars
 * (referee, provider, operator). Shared by settle-tx / protocol tests.
 */
import { ArkAddress, CSVMultisigTapscript } from '@arkade-os/sdk';
import { IndividualPubkey, keyAggExport, keyAggregate } from '@scure/btc-signer/musig2.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import type { ExtroRuntimeConfig } from '$lib/extro/release-config';
import { buildArkSwapContract, type VerifiedArkContractPlan } from './swap-contract';

const hx = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const testScalar = (n: number): Uint8Array => {
	const k = new Uint8Array(32);
	k[31] = n;
	k[0] = 0x42;
	return k;
};
export const TEST_REFEREE_SK = testScalar(1);
export const TEST_PROVIDER_SK = testScalar(2);
const OPERATOR = testScalar(3);
export const TEST_REFEREE_PUB = IndividualPubkey(TEST_REFEREE_SK);
export const TEST_PROVIDER_PUB = IndividualPubkey(TEST_PROVIDER_SK);
export const TEST_Q = keyAggExport(keyAggregate([TEST_REFEREE_PUB, TEST_PROVIDER_PUB]));
export const TEST_OPERATOR_X = schnorr.getPublicKey(OPERATOR);
const addr = (seed: number) => new ArkAddress(TEST_OPERATOR_X, schnorr.getPublicKey(testScalar(seed)), 'tark').encode();
export const TEST_CHECKPOINT_HEX = hx(
	CSVMultisigTapscript.encode({ pubkeys: [TEST_OPERATOR_X], timelock: { type: 'blocks', value: 144n } }).script
);

export function testSwapContract(swapId = 'settle-tx-fixture') {
	const plan: VerifiedArkContractPlan = {
		swapId,
		requestCommitment: Uint8Array.from({ length: 32 }, (_, i) => i + 7),
		aggregateOwnerKey: TEST_Q,
		providerRecoveryKey: schnorr.getPublicKey(testScalar(4)),
		operatorSignerKey: TEST_OPERATOR_X,
		operatorInfoDigest: new Uint8Array(32).fill(0x62),
		unilateralExitDelay: 86_016n,
		amountSats: 25_000n,
		network: 'signet',
		providerDestination: addr(9),
		bearerSellerDestination: addr(8),
		expiresAtUnix: 4_000_000_000n
	};
	const config = {
		ark_enabled: true,
		ark_network: 'signet',
		ark_signer_pk_hex: hx(TEST_OPERATOR_X),
		ark_info_digest_hex: '62'.repeat(32),
		ark_checkpoint_tapscript_hex: TEST_CHECKPOINT_HEX,
		ark_unilateral_exit_delay: 86_016
	} as unknown as ExtroRuntimeConfig;
	return buildArkSwapContract(config, plan, 1n);
}
