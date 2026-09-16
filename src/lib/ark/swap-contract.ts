import {
	CSVMultisigTapscript,
	DefaultVtxo,
	VtxoScript,
	contractHandlers,
	getNetwork,
	scriptFromTapLeafScript,
	type Contract,
	type ContractHandler,
	type ContractWithVtxos,
	type IContractManager,
	type RelativeTimelock
} from '@arkade-os/sdk';
import { getExtroClient } from '$lib/extro';
import { newRequestId, type ArkPrepareTerms } from '$lib/extro/commands';
import type { ExtroRuntimeConfig } from '$lib/extro/runtime-config';

export const WEBYCASH_ARK_CONTRACT_TYPE = 'webycash-musig2-v2';

export interface VerifiedArkContractPlan {
	swapId: string;
	requestCommitment: Uint8Array;
	aggregateOwnerKey: Uint8Array;
	providerRecoveryKey: Uint8Array;
	operatorSignerKey: Uint8Array;
	operatorInfoDigest: Uint8Array;
	unilateralExitDelay: bigint;
	amountSats: bigint;
	network: 'regtest' | 'signet' | 'bitcoin';
	providerDestination: string;
	bearerSellerDestination: string;
	expiresAtUnix: bigint;
}

export interface ArkSwapContract {
	plan: VerifiedArkContractPlan;
	script: VtxoScript;
	address: string;
	pkScriptHex: string;
	tapTree: Uint8Array;
	contract: Omit<Contract, 'createdAt'>;
}

const bytesToHex = (value: Uint8Array): string =>
	Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hexToBytes = (value: string, length: number, name: string): Uint8Array => {
	if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, 'i').test(value)) {
		throw new Error(`${name} must be exactly ${length} bytes of hexadecimal data`);
	}
	return Uint8Array.from({ length }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
};

const exactBytes = (value: Uint8Array, length: number, name: string): Uint8Array => {
	if (!(value instanceof Uint8Array) || value.length !== length) {
		throw new Error(`${name} must be exactly ${length} bytes`);
	}
	if (value.every((byte) => byte === 0)) throw new Error(`${name} must not be all zero`);
	return value.slice();
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, index) => byte === b[index]);

const delayToTimelock = (delay: bigint): RelativeTimelock => {
	if (delay <= 0n) throw new Error('Ark unilateral exit delay must be positive');
	if (delay >= 512n && delay % 512n !== 0n) {
		throw new Error('second-based Ark unilateral exit delay must be a multiple of 512');
	}
	return { value: delay, type: delay < 512n ? 'blocks' : 'seconds' };
};

const commitmentLeaf = (commitment: Uint8Array): Uint8Array => {
	const leaf = new Uint8Array(34);
	leaf[0] = 0x6a; // OP_RETURN: unspendable, but commits this address to one prepare request.
	leaf[1] = 0x20; // direct push of the 32-byte request commitment.
	leaf.set(exactBytes(commitment, 32, 'request commitment'), 2);
	return leaf;
};

interface StoredContractParams {
	aggregateOwnerKey: Uint8Array;
	providerRecoveryKey: Uint8Array;
	operatorSignerKey: Uint8Array;
	requestCommitment: Uint8Array;
	unilateralExitDelay: bigint;
}

function createSwapScript(params: StoredContractParams): VtxoScript {
	const timelock = delayToTimelock(params.unilateralExitDelay);
	// Ark's collaborative leaf remains operator + one owner key. That owner is
	// the provider/referee MuSig2 aggregate. The CSV path intentionally uses the
	// provider's standalone key instead, so referee loss cannot destroy recovery.
	const standard = new DefaultVtxo.Script({
		pubKey: exactBytes(params.aggregateOwnerKey, 32, 'aggregate owner key'),
		serverPubKey: exactBytes(params.operatorSignerKey, 32, 'operator signer key'),
		csvTimelock: timelock
	});
	const recovery = CSVMultisigTapscript.encode({
		pubkeys: [exactBytes(params.providerRecoveryKey, 32, 'provider recovery key')],
		timelock
	});
	return new VtxoScript([
		scriptFromTapLeafScript(standard.forfeit()),
		recovery.script,
		commitmentLeaf(params.requestCommitment)
	]);
}

const handler: ContractHandler<StoredContractParams, VtxoScript> = {
	type: WEBYCASH_ARK_CONTRACT_TYPE,
	createScript(params) {
		return createSwapScript(this.deserializeParams(params));
	},
	serializeParams(params) {
		return {
			aggregateOwnerKey: bytesToHex(params.aggregateOwnerKey),
			providerRecoveryKey: bytesToHex(params.providerRecoveryKey),
			operatorSignerKey: bytesToHex(params.operatorSignerKey),
			requestCommitment: bytesToHex(params.requestCommitment),
			unilateralExitDelay: params.unilateralExitDelay.toString()
		};
	},
	deserializeParams(params) {
		if (!/^[1-9][0-9]*$/.test(params.unilateralExitDelay ?? '')) {
			throw new Error('unilateralExitDelay must be a positive decimal integer');
		}
		return {
			aggregateOwnerKey: hexToBytes(params.aggregateOwnerKey, 32, 'aggregateOwnerKey'),
			providerRecoveryKey: hexToBytes(params.providerRecoveryKey, 32, 'providerRecoveryKey'),
			operatorSignerKey: hexToBytes(params.operatorSignerKey, 32, 'operatorSignerKey'),
			requestCommitment: hexToBytes(params.requestCommitment, 32, 'requestCommitment'),
			unilateralExitDelay: BigInt(params.unilateralExitDelay)
		};
	},
	selectPath() {
		return null;
	},
	getAllSpendingPaths() {
		return [];
	},
	getSpendablePaths() {
		return [];
	},
	isGenericallySpendable() {
		return false;
	},
	assertSpendableNow() {
		throw new Error(
			'WebyCash Ark escrow requires the dedicated MuSig2 or provider-recovery signer'
		);
	}
};

export function registerArkSwapContractHandler(): void {
	if (!contractHandlers.has(WEBYCASH_ARK_CONTRACT_TYPE)) contractHandlers.register(handler);
}

/**
 * Re-open the signed referee response inside extro-node and derive the aggregate
 * key from the exact V2 terms. The browser never implements BIP327 key
 * aggregation independently.
 */
export async function deriveVerifiedArkContractPlan(input: {
	terms: ArkPrepareTerms;
	signedResponse: Uint8Array;
	refereeVk: Uint8Array;
	nowUnix?: number;
}): Promise<VerifiedArkContractPlan> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Scheme402',
			cmd: {
				op: 'DeriveArkContractPlan',
				terms: input.terms,
				signed_response: input.signedResponse,
				referee_vk: exactBytes(input.refereeVk, 32, 'referee verifying key'),
				now_unix: input.nowUnix ?? Math.floor(Date.now() / 1000)
			}
		}
	});
	if (response.kind === 'Err') throw new Error(`DeriveArkContractPlan: ${response.message}`);
	if (response.body.kind !== 'ArkContractPlan') {
		throw new Error(`DeriveArkContractPlan: unexpected ${response.body.kind}`);
	}
	return {
		swapId: response.body.swap_id,
		requestCommitment: exactBytes(response.body.request_commitment, 32, 'request commitment'),
		aggregateOwnerKey: exactBytes(response.body.aggregate_owner_key, 32, 'aggregate owner key'),
		providerRecoveryKey: exactBytes(
			response.body.provider_recovery_key,
			32,
			'provider recovery key'
		),
		operatorSignerKey: exactBytes(
			response.body.ark_operator_signer_pk,
			32,
			'operator signer key'
		),
		operatorInfoDigest: exactBytes(
			response.body.ark_operator_info_digest,
			32,
			'operator info digest'
		),
		unilateralExitDelay: response.body.ark_unilateral_exit_delay,
		amountSats: response.body.ark_amount_sats,
		network: response.body.ark_network,
		providerDestination: response.body.provider_ark_destination,
		bearerSellerDestination: response.body.bearer_seller_ark_destination,
		expiresAtUnix: response.body.expires_at_unix
	};
}

/** Build the exact, request-unique Ark script after checking every runtime pin. */
export function buildArkSwapContract(
	config: ExtroRuntimeConfig,
	plan: VerifiedArkContractPlan,
	nowUnix = BigInt(Math.floor(Date.now() / 1000))
): ArkSwapContract {
	if (!config.ark_enabled) throw new Error('Ark is disabled in runtime configuration');
	if (plan.expiresAtUnix <= nowUnix) throw new Error('Ark contract plan has expired');
	if (plan.network !== config.ark_network) throw new Error('Ark contract network does not match runtime pin');
	const configuredOperator = hexToBytes(config.ark_signer_pk_hex, 32, 'runtime Ark signer');
	const configuredDigest = hexToBytes(config.ark_info_digest_hex, 32, 'runtime Ark info digest');
	if (!sameBytes(plan.operatorSignerKey, configuredOperator)) {
		throw new Error('Ark contract operator signer does not match runtime pin');
	}
	if (!sameBytes(plan.operatorInfoDigest, configuredDigest)) {
		throw new Error('Ark contract operator info digest does not match runtime pin');
	}
	if (plan.unilateralExitDelay !== BigInt(config.ark_unilateral_exit_delay)) {
		throw new Error('Ark contract unilateral exit delay does not match runtime pin');
	}
	if (plan.amountSats <= 0n || plan.amountSats > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('Ark amount is outside the exact range supported by the pinned SDK');
	}
	const stored: StoredContractParams = {
		aggregateOwnerKey: exactBytes(plan.aggregateOwnerKey, 32, 'aggregate owner key'),
		providerRecoveryKey: exactBytes(plan.providerRecoveryKey, 32, 'provider recovery key'),
		operatorSignerKey: exactBytes(plan.operatorSignerKey, 32, 'operator signer key'),
		requestCommitment: exactBytes(plan.requestCommitment, 32, 'request commitment'),
		unilateralExitDelay: plan.unilateralExitDelay
	};
	const script = createSwapScript(stored);
	const address = script.address(getNetwork(plan.network).hrp, stored.operatorSignerKey).encode();
	const params = handler.serializeParams(stored);
	return {
		plan,
		script,
		address,
		pkScriptHex: bytesToHex(script.pkScript),
		tapTree: script.encode(),
		contract: {
			type: WEBYCASH_ARK_CONTRACT_TYPE,
			label: `WebyCash swap ${plan.swapId}`,
			params,
			script: bytesToHex(script.pkScript),
			address,
			state: 'active',
			watch: 'watched',
			metadata: {
				swapId: plan.swapId,
				requestCommitment: bytesToHex(plan.requestCommitment),
				amountSats: plan.amountSats.toString(),
				providerDestination: plan.providerDestination,
				bearerSellerDestination: plan.bearerSellerDestination
			}
		}
	};
}

export async function registerArkSwapContract(
	manager: Pick<IContractManager, 'createContract'>,
	value: ArkSwapContract
): Promise<Contract> {
	registerArkSwapContractHandler();
	return manager.createContract(value.contract);
}

export interface ArkFundingWallet {
	send(input: {
		recipients: [{ address: string; amount: number; tapTree: Uint8Array }];
	}): Promise<string>;
}

/** Submit a real Ark send with the exact script tree required for recovery. */
export async function fundArkSwapContract(
	wallet: ArkFundingWallet,
	value: ArkSwapContract
): Promise<{ arkTxId: string; amountSats: bigint; address: string }> {
	const arkTxId = await wallet.send({
		recipients: [
			{
				address: value.address,
				amount: Number(value.plan.amountSats),
				tapTree: value.tapTree.slice()
			}
		]
	});
	if (!/^[0-9a-f]{64}$/i.test(arkTxId)) {
		throw new Error('Ark operator returned a malformed funding transaction id');
	}
	return { arkTxId: arkTxId.toLowerCase(), amountSats: value.plan.amountSats, address: value.address };
}

export interface ArkFundingReader {
	refreshVtxos(options: { scripts: string[] }): Promise<void>;
	getContractsWithVtxos(filter: { script: string }): Promise<ContractWithVtxos[]>;
}

export interface ConfirmedArkFunding {
	lockedRef: string;
	amountSats: bigint;
	createdAt: Date;
	expiresAt?: Date;
	expiresAtHeight?: number;
}

/**
 * Re-read the exact outpoint from Ark's indexer-backed contract manager. Proof
 * construction is not allowed to trust the maker's DHTX `locked_ref` alone.
 */
export async function confirmArkSwapFunding(
	reader: ArkFundingReader,
	value: ArkSwapContract,
	expectedLockedRef: string
): Promise<ConfirmedArkFunding> {
	const match = /^([0-9a-f]{64}):(\d+)$/i.exec(expectedLockedRef);
	if (!match) throw new Error('Ark locked_ref must be an exact txid:vout');
	const vout = Number(match[2]);
	if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff) {
		throw new Error('Ark locked_ref vout is outside the u32 range');
	}
	const lockedRef = `${match[1].toLowerCase()}:${vout}`;
	await reader.refreshVtxos({ scripts: [value.pkScriptHex] });
	const contracts = await reader.getContractsWithVtxos({ script: value.pkScriptHex });
	const candidates = contracts
		.filter((entry) => entry.contract.script.toLowerCase() === value.pkScriptHex)
		.flatMap((entry) => entry.vtxos)
		.filter((vtxo) => `${vtxo.txid.toLowerCase()}:${vtxo.vout}` === lockedRef);
	if (candidates.length !== 1) {
		throw new Error(`Ark locked_ref resolved to ${candidates.length} VTXOs, expected exactly one`);
	}
	const [vtxo] = candidates;
	if (vtxo.script.toLowerCase() !== value.pkScriptHex) {
		throw new Error('Ark VTXO script does not match the prepared contract');
	}
	if (BigInt(vtxo.value) !== value.plan.amountSats) {
		throw new Error('Ark VTXO amount does not match the dual-signed prepare terms');
	}
	if (vtxo.isSpent || vtxo.isSwept || vtxo.isUnrolled) {
		throw new Error('Ark VTXO is already spent, swept, or unrolled');
	}
	return {
		lockedRef,
		amountSats: BigInt(vtxo.value),
		createdAt: vtxo.createdAt,
		expiresAt: vtxo.expiresAt,
		expiresAtHeight: vtxo.expiresAtHeight
	};
}
