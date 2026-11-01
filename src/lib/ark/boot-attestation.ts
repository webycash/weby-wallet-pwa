import { arkStatus } from './ark-status.svelte';
import {
	attestConfiguredArkOperator,
	verifyArkOperatorDigest,
	type ArkOperatorAttestation
} from './operator';
import { disableArkForSession, type ExtroRuntimeConfig } from '$lib/extro/release-config';

export interface ArkBootSteps {
	/** Release pins (network, signer, checkpoint, exit delay) against the live `/v1/info`. */
	attest: (config: ExtroRuntimeConfig) => Promise<ArkOperatorAttestation | null>;
	/** extro-node's canonical `Op::Ark OperatorInfoDigest` against the release pin. */
	verifyDigest: (config: ExtroRuntimeConfig, att: ArkOperatorAttestation) => Promise<ArkOperatorAttestation>;
}

const liveSteps: ArkBootSteps = {
	attest: (config) => attestConfiguredArkOperator(config),
	verifyDigest: verifyArkOperatorDigest
};

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function disable(loaded: ExtroRuntimeConfig, reason: string): ExtroRuntimeConfig {
	const received =
		/info digest mismatch: expected [0-9a-f]{64}, received ([0-9a-f]{64})/i.exec(reason)?.[1] ?? null;
	arkStatus.ok = false;
	arkStatus.reason = reason;
	arkStatus.receivedDigest = received;
	arkStatus.expectedDigest = loaded.ark_info_digest_hex;
	arkStatus.attestation = null;
	console.error('[ark] operator attestation failed; Ark disabled for this session', {
		reason,
		expected_digest: loaded.ark_info_digest_hex,
		received_digest: received
	});
	return disableArkForSession();
}

/**
 * Boot extro-node and attest the Ark operator, fail-soft.
 *
 * The release pins are checked against the live operator before the node
 * boots; a pin mismatch boots the node with Ark disabled. The info-digest pin
 * is extro-node's canonical digest, so it is checked right after boot through
 * `Op::Ark OperatorInfoDigest`. A digest mismatch disables Ark for the session
 * in the runtime config every Ark path reads (`getRuntimeConfig()`), and every
 * contract/claim op re-checks the live digest anyway, so nothing can lock or
 * sign against an unpinned operator. Webcash and vouchers keep working.
 *
 * Returns the effective runtime config for this session.
 */
export async function bootWithArkAttestation(
	loaded: ExtroRuntimeConfig,
	bootNode: (config: ExtroRuntimeConfig) => void,
	steps: ArkBootSteps = liveSteps
): Promise<ExtroRuntimeConfig> {
	if (!loaded.ark_enabled) {
		arkStatus.ok = false;
		arkStatus.reason = 'Ark is disabled in runtime configuration';
		bootNode(loaded);
		return loaded;
	}
	let att: ArkOperatorAttestation | null;
	try {
		att = await steps.attest(loaded);
		if (!att) throw new Error('Ark is disabled in runtime configuration');
	} catch (error) {
		const config = disable(loaded, reasonOf(error));
		bootNode(config);
		return config;
	}
	bootNode(loaded);
	try {
		const verified = await steps.verifyDigest(loaded, att);
		arkStatus.ok = true;
		arkStatus.reason = null;
		arkStatus.receivedDigest = null;
		arkStatus.expectedDigest = loaded.ark_info_digest_hex;
		arkStatus.attestation = {
			url: verified.url,
			network: verified.network,
			signer_pk_hex: verified.signer_pk_hex,
			info_digest: loaded.ark_info_digest_hex,
			unilateral_exit_delay: String(verified.unilateral_exit_delay)
		};
		return loaded;
	} catch (error) {
		return disable(loaded, reasonOf(error));
	}
}
