import type { ArkInfo } from '@arkade-os/sdk';
import { newRequestId, type WireArkOperatorInfo } from '@extro/node';

import { getExtroClient } from '$lib/extro';
import type { ExtroRuntimeConfig } from '$lib/extro/release-config';

/** Small injectable boundary so validation tests never need a live operator. */
export interface ArkInfoProvider {
	getInfo(): Promise<
		Pick<
			ArkInfo,
			| 'network'
			| 'signerPubkey'
			| 'forfeitPubkey'
			| 'forfeitAddress'
			| 'boardingExitDelay'
			| 'dust'
			| 'vtxoMinAmount'
			| 'digest'
			| 'checkpointTapscript'
			| 'unilateralExitDelay'
			| 'version'
		>
	>;
}

export interface ArkOperatorAttestation {
	url: string;
	network: ExtroRuntimeConfig['ark_network'];
	signer_pk_hex: string;
	/**
	 * The digest arkd itself reports. Informational only: it is not the pinned
	 * `ark_info_digest_hex`, which is extro-node's canonical digest of the
	 * claim-relevant fields ({@link verifyArkOperatorDigest}).
	 */
	info_digest: string;
	/** Claim-relevant operator info, as extro-node's `Op::Ark` consumes it. */
	operator: WireArkOperatorInfo;
	checkpoint_tapscript: string;
	unilateral_exit_delay: bigint;
	version: string;
}

export class ArkOperatorAttestationError extends Error {
	constructor(message: string) {
		super(`Ark operator attestation: ${message}`);
		this.name = 'ArkOperatorAttestationError';
	}
}

/** The claim-relevant fields of arkd's info, in extro-node's wire shape. */
export function arkOperatorWireInfo(
	network: ExtroRuntimeConfig['ark_network'],
	info: Awaited<ReturnType<ArkInfoProvider['getInfo']>>
): WireArkOperatorInfo {
	return {
		network,
		signer_pubkey_hex: info.signerPubkey.toLowerCase(),
		forfeit_pubkey_hex: info.forfeitPubkey.toLowerCase(),
		forfeit_address: info.forfeitAddress,
		checkpoint_tapscript_hex: info.checkpointTapscript.toLowerCase(),
		unilateral_exit_delay: info.unilateralExitDelay,
		boarding_exit_delay: info.boardingExitDelay,
		dust: info.dust,
		vtxo_min_amount: info.vtxoMinAmount
	};
}

const hex = (value: string, length: number, name: string): string => {
	const normalized = value.toLowerCase();
	if (normalized.length !== length || !/^[0-9a-f]+$/.test(normalized)) {
		throw new ArkOperatorAttestationError(`${name} must be ${length} hexadecimal characters`);
	}
	if (/^0+$/.test(normalized)) {
		throw new ArkOperatorAttestationError(`${name} must not be all zero`);
	}
	return normalized;
};

/**
 * Verify the live operator identity and safety-critical policy against release
 * configuration. The signer, checkpoint script and exit delay are immutable
 * release pins checked here, before extro-node boots; the info-digest pin is
 * extro-node's canonical digest and is checked by
 * {@link verifyArkOperatorDigest} before any swap contract or claim is built.
 */
export function validateArkOperatorInfo(
	config: ExtroRuntimeConfig,
	info: Awaited<ReturnType<ArkInfoProvider['getInfo']>>
): ArkOperatorAttestation {
	if (!config.ark_enabled) {
		throw new ArkOperatorAttestationError('Ark is disabled in runtime configuration');
	}
	if (info.network !== config.ark_network) {
		throw new ArkOperatorAttestationError(
			`network mismatch: configured ${config.ark_network}, operator reported ${info.network}`
		);
	}

	const compressedSigner = hex(info.signerPubkey, 66, 'operator signerPubkey');
	if (compressedSigner[0] !== '0' || !['2', '3'].includes(compressedSigner[1])) {
		throw new ArkOperatorAttestationError(
			'operator signerPubkey is not a compressed secp256k1 key'
		);
	}
	const xOnlySigner = compressedSigner.slice(2);
	if (xOnlySigner !== config.ark_signer_pk_hex) {
		throw new ArkOperatorAttestationError(
			`signer mismatch: expected ${config.ark_signer_pk_hex}, received ${xOnlySigner}`
		);
	}

	const digest = hex(info.digest, 64, 'operator info digest');
	if (!info.checkpointTapscript || !/^[0-9a-f]+$/i.test(info.checkpointTapscript)) {
		throw new ArkOperatorAttestationError('operator checkpointTapscript is missing or malformed');
	}
	const checkpoint = info.checkpointTapscript.toLowerCase();
	if (checkpoint !== config.ark_checkpoint_tapscript_hex) {
		throw new ArkOperatorAttestationError(
			'operator checkpointTapscript does not match the release pin'
		);
	}
	if (info.unilateralExitDelay !== BigInt(config.ark_unilateral_exit_delay)) {
		throw new ArkOperatorAttestationError(
			`unilateralExitDelay mismatch: expected ${config.ark_unilateral_exit_delay}, received ${info.unilateralExitDelay}`
		);
	}

	return {
		url: config.ark_asp_url,
		network: config.ark_network,
		signer_pk_hex: xOnlySigner,
		info_digest: digest,
		operator: arkOperatorWireInfo(config.ark_network, info),
		checkpoint_tapscript: checkpoint,
		unilateral_exit_delay: info.unilateralExitDelay,
		version: info.version
	};
}

/** Fetch and validate the configured operator. Disabled development builds skip it. */
export async function attestConfiguredArkOperator(
	config: ExtroRuntimeConfig,
	provider?: ArkInfoProvider
): Promise<ArkOperatorAttestation | null> {
	if (!config.ark_enabled) return null;
	const live = provider ?? new (await import('@arkade-os/sdk')).RestArkProvider(config.ark_asp_url);
	let info: Awaited<ReturnType<ArkInfoProvider['getInfo']>>;
	try {
		info = await live.getInfo();
	} catch (error) {
		throw new ArkOperatorAttestationError(
			`GET ${config.ark_asp_url}/v1/info failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	return validateArkOperatorInfo(config, info);
}

/** extro-node's canonical digest of the operator's claim-relevant info (`Op::Ark OperatorInfoDigest`). */
export async function arkOperatorInfoDigest(operator: WireArkOperatorInfo): Promise<string> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Ark', cmd: { op: 'OperatorInfoDigest', operator } }
	});
	if (response.kind === 'Err') {
		throw new ArkOperatorAttestationError(`OperatorInfoDigest: ${response.message}`);
	}
	if (response.body.kind !== 'ArkOperatorDigest') {
		throw new ArkOperatorAttestationError(`OperatorInfoDigest: unexpected ${response.body.kind}`);
	}
	return Array.from(response.body.digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fail closed unless the canonical digest of the live operator equals the release pin. */
export async function verifyArkOperatorDigest(
	config: ExtroRuntimeConfig,
	attestation: ArkOperatorAttestation
): Promise<ArkOperatorAttestation> {
	const digest = await arkOperatorInfoDigest(attestation.operator);
	if (digest !== config.ark_info_digest_hex) {
		throw new ArkOperatorAttestationError(
			`info digest mismatch: expected ${config.ark_info_digest_hex}, received ${digest}`
		);
	}
	return attestation;
}

/**
 * The live, fully pinned operator a swap builds its contract and claims
 * against: release pins plus extro-node's canonical info digest.
 */
export async function verifiedArkOperator(
	config: ExtroRuntimeConfig,
	provider?: ArkInfoProvider
): Promise<ArkOperatorAttestation> {
	const attestation = await attestConfiguredArkOperator(config, provider);
	if (!attestation) throw new ArkOperatorAttestationError('Ark is disabled in runtime configuration');
	return verifyArkOperatorDigest(config, attestation);
}
