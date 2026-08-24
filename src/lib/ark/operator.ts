import type { ArkInfo } from '@arkade-os/sdk';

import type { ExtroRuntimeConfig } from '$lib/extro/runtime-config';

/** Small injectable boundary so validation tests never need a live operator. */
export interface ArkInfoProvider {
	getInfo(): Promise<
		Pick<
			ArkInfo,
			| 'network'
			| 'signerPubkey'
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
	info_digest: string;
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
 * configuration. The signer, info digest, checkpoint script and exit delay are
 * immutable release pins. A mismatch aborts application boot before funds can
 * move.
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
	if (digest !== config.ark_info_digest_hex) {
		throw new ArkOperatorAttestationError(
			`info digest mismatch: expected ${config.ark_info_digest_hex}, received ${digest}`
		);
	}
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
