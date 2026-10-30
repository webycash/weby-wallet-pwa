import type { VerifiedArkContractPlan } from './swap-contract';

const hex = (value: string): Uint8Array =>
	Uint8Array.from({ length: value.length / 2 }, (_, i) => Number.parseInt(value.slice(i * 2, i * 2 + 2), 16));

/** Shared test fixture (no keys: public points only). */
export const fixturePlan = (): VerifiedArkContractPlan => ({
	swapId: 'b3-fixture',
	requestCommitment: Uint8Array.from({ length: 32 }, (_, i) => i + 5),
	aggregateOwnerKey: hex('f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'),
	providerRecoveryKey: hex('c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'),
	operatorSignerKey: hex('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
	operatorInfoDigest: new Uint8Array(32).fill(0x62),
	unilateralExitDelay: 86_016n,
	amountSats: 1_000n,
	network: 'signet',
	providerDestination: 'tark1provider',
	bearerSellerDestination: 'tark1seller',
	expiresAtUnix: 4_000_000_000n
});
