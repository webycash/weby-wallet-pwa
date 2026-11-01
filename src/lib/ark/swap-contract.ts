/**
 * The webycash Ark swap contract — wallet side, as thin calls into extro-node
 * (ADR-0007, audit H2). The contract is built once, in extro-node's
 * `ark_protocol::SwapContract` (`Op::Ark SwapContract`): the canonical 2-leaf
 * taptree arkd accepts,
 *
 *   forfeit:  <Q> CHECKSIGVERIFY <operator> CHECKSIG
 *   recovery: <delay> CSV DROP <provider> CHECKSIG   (seconds-only delays)
 *
 * with Q the per-swap tweaked referee/provider key (audit C1). JS only checks
 * the runtime pins, hands the node's `tap_tree` to the SDK for funding /
 * contract-manager transport, and fails closed if the SDK's decoding of that
 * tree disagrees with the node's script or address.
 *
 * Supersedes the in-TS 3-leaf contract (DefaultVtxo forfeit + CSV recovery +
 * an OP_RETURN request-commitment leaf), which arkd cannot parse. A VTXO
 * already funded to such a 3-leaf script is recoverable only via its provider
 * CSV leaf.
 */
import {
	VtxoScript,
	contractHandlers,
	getNetwork,
	type Contract,
	type ContractHandler,
	type ContractWithVtxos,
	type IContractManager
} from '@arkade-os/sdk';
import { getExtroClient } from '$lib/extro';
import { newRequestId, type ArkPrepareTerms, type WireArkOperatorInfo } from '@extro/node';
import type { ExtroRuntimeConfig } from '$lib/extro/release-config';
import { arkOperatorInfoDigest } from './operator';

export const WEBYCASH_ARK_CONTRACT_TYPE = 'webycash-musig2-v3';

export interface VerifiedArkContractPlan {
	swapId: string;
	requestCommitment: Uint8Array;
	/** Referee MuSig2 key (compressed hex) Q is aggregated from. */
	refereePubkeyHex: string;
	/** Provider MuSig2 key (compressed hex) Q is aggregated from. */
	providerPubkeyHex: string;
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
	/** SDK view of the node's taptree (transport only: funding, indexer, contract manager). */
	script: VtxoScript;
	address: string;
	pkScriptHex: string;
	tapTree: Uint8Array;
	/** The live operator whose canonical digest equals the plan's pinned digest. */
	operator: WireArkOperatorInfo;
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

const anyHexToBytes = (value: string, name: string): Uint8Array => {
	if (!/^([0-9a-f]{2})+$/i.test(value)) throw new Error(`${name} must be hexadecimal data`);
	return hexToBytes(value, value.length / 2, name);
};

const exactBytes = (value: Uint8Array, length: number, name: string): Uint8Array => {
	if (!(value instanceof Uint8Array) || value.length !== length) {
		throw new Error(`${name} must be exactly ${length} bytes`);
	}
	if (value.every((byte) => byte === 0)) throw new Error(`${name} must not be all zero`);
	return value.slice();
};

const compressedKeyHex = (value: string, name: string): string => {
	if (!/^0[23][0-9a-f]{64}$/i.test(value)) throw new Error(`${name} must be a compressed secp256k1 key`);
	return value.toLowerCase();
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, index) => byte === b[index]);

interface StoredContractParams {
	/** The node-built taptree (SDK `TapTree` encoding). */
	tapTree: Uint8Array;
}

/** SDK view of a node-built taptree. Decoding only; no script is built in JS. */
const decodeTapTree = (tapTree: Uint8Array): VtxoScript => VtxoScript.decode(tapTree);

const handler: ContractHandler<StoredContractParams, VtxoScript> = {
	type: WEBYCASH_ARK_CONTRACT_TYPE,
	createScript(params) {
		return decodeTapTree(this.deserializeParams(params).tapTree);
	},
	serializeParams(params) {
		return { tapTree: bytesToHex(params.tapTree) };
	},
	deserializeParams(params) {
		return { tapTree: anyHexToBytes(params.tapTree ?? '', 'tapTree') };
	},
	selectPath() {
		return null;
	},
	getAllSpendingPaths() {
		// Settle / refund claims are built and signed by extro-node (settle-tx.ts).
		// The generic SDK spender must see an empty path set.
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
		refereePubkeyHex: compressedKeyHex(response.body.referee_pubkey_hex, 'referee MuSig2 key'),
		providerPubkeyHex: compressedKeyHex(response.body.provider_pubkey_hex, 'provider MuSig2 key'),
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

/**
 * Build the exact, request-unique Ark contract (`Op::Ark SwapContract`) after
 * checking every runtime pin. Fails closed unless the live `operator`'s
 * canonical digest is the plan's pinned digest, the node's Q equals the
 * referee-verified plan's aggregate key, and the SDK's decoding of the node's
 * taptree yields the node's own script and address.
 */
export async function buildArkSwapContract(
	config: ExtroRuntimeConfig,
	plan: VerifiedArkContractPlan,
	operator: WireArkOperatorInfo,
	nowUnix = BigInt(Math.floor(Date.now() / 1000))
): Promise<ArkSwapContract> {
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
	if ((await arkOperatorInfoDigest(operator)) !== bytesToHex(plan.operatorInfoDigest)) {
		throw new Error('live Ark operator info does not match the pinned operator info digest');
	}
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Ark',
			cmd: {
				op: 'SwapContract',
				referee_pubkey_hex: compressedKeyHex(plan.refereePubkeyHex, 'referee MuSig2 key'),
				provider_pubkey_hex: compressedKeyHex(plan.providerPubkeyHex, 'provider MuSig2 key'),
				swap_id: plan.swapId,
				request_commitment: exactBytes(plan.requestCommitment, 32, 'request commitment'),
				operator_signer_pk: exactBytes(plan.operatorSignerKey, 32, 'operator signer key'),
				network: plan.network,
				exit_delay: plan.unilateralExitDelay
			}
		}
	});
	if (response.kind === 'Err') throw new Error(`SwapContract: ${response.message}`);
	if (response.body.kind !== 'ArkSwapContract') {
		throw new Error(`SwapContract: unexpected ${response.body.kind}`);
	}
	const built = response.body;
	if (!sameBytes(built.owner_q, plan.aggregateOwnerKey)) {
		throw new Error('Ark contract owner key does not match the referee-verified plan');
	}
	const tapTree = built.tap_tree.slice();
	const script = decodeTapTree(tapTree);
	const pkScriptHex = bytesToHex(built.script_pubkey);
	if (bytesToHex(script.pkScript) !== pkScriptHex) {
		throw new Error('SDK decoding of the node taptree disagrees with the node script');
	}
	const address = built.address;
	if (script.address(getNetwork(plan.network).hrp, plan.operatorSignerKey).encode() !== address) {
		throw new Error('SDK decoding of the node taptree disagrees with the node address');
	}
	const params = handler.serializeParams({ tapTree });
	return {
		plan,
		script,
		address,
		pkScriptHex,
		tapTree,
		operator,
		contract: {
			type: WEBYCASH_ARK_CONTRACT_TYPE,
			label: `WebyCash swap ${plan.swapId}`,
			params,
			script: pkScriptHex,
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
