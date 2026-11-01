/**
 * TEST-ONLY Ark swap contract over deterministic, never-funded scalars
 * (referee, provider, operator). Shared by settle-tx / protocol tests.
 */
import { ArkAddress, CSVMultisigTapscript } from '@arkade-os/sdk';
import { createHash } from 'node:crypto';
import { IndividualPubkey, Session, keyAggExport, keyAggregate } from '@scure/btc-signer/musig2.js';
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
const TEST_KEYS = [TEST_REFEREE_PUB, TEST_PROVIDER_PUB];
export const TEST_SWAP_ID = 'settle-tx-fixture';
export const TEST_REQUEST_COMMITMENT = Uint8Array.from({ length: 32 }, (_, i) => i + 7);

/**
 * Test-only mirror of extro-node `swap_key_tweak` (audit C1), so the simulated
 * referee/provider below can sign under the per-swap tweaked key. Production
 * never computes it in TS; settle-bundle.test pins it to `Op::Ark SwapOwnerKey`.
 */
export function testSwapKeyTweak(swapId: string, requestCommitment: Uint8Array): Uint8Array {
	const tag = createHash('sha256').update('extro/ark-swap-key-tweak/v1').digest();
	const len = Buffer.alloc(8);
	len.writeBigUInt64BE(BigInt(Buffer.byteLength(swapId)));
	return new Uint8Array(
		createHash('sha256').update(tag).update(tag).update(len).update(swapId).update(requestCommitment).digest()
	);
}
/** The per-swap tweaked x-only owner key Q of the test keys. */
export const testOwnerKey = (swapId: string, requestCommitment: Uint8Array): Uint8Array =>
	keyAggExport(keyAggregate(TEST_KEYS, [testSwapKeyTweak(swapId, requestCommitment)], [true]));
/** A simulated signer's BIP327 session under the tweaked [referee, provider] key. */
export const testSigningSession = (
	aggNonce: Uint8Array,
	msg: Uint8Array,
	swapId: string,
	requestCommitment: Uint8Array
): Session => new Session(aggNonce, TEST_KEYS, msg, [testSwapKeyTweak(swapId, requestCommitment)], [true]);
export const TEST_Q = testOwnerKey(TEST_SWAP_ID, TEST_REQUEST_COMMITMENT);
export const TEST_OPERATOR_X = schnorr.getPublicKey(OPERATOR);
const addr = (seed: number) => new ArkAddress(TEST_OPERATOR_X, schnorr.getPublicKey(testScalar(seed)), 'tark').encode();
export const TEST_CHECKPOINT_HEX = hx(
	CSVMultisigTapscript.encode({ pubkeys: [TEST_OPERATOR_X], timelock: { type: 'blocks', value: 144n } }).script
);

export function testSwapContract(swapId = TEST_SWAP_ID, requestCommitment = TEST_REQUEST_COMMITMENT) {
	const plan: VerifiedArkContractPlan = {
		swapId,
		requestCommitment,
		aggregateOwnerKey: testOwnerKey(swapId, requestCommitment),
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
