/** Session Ark availability after boot-time operator attestation. */
export interface ArkStatus {
	/** null until attestation ran; true = attested; false = disabled (see reason). */
	ok: boolean | null;
	reason: string | null;
	/** `/v1/info` digest the live operator returned, when known. */
	receivedDigest: string | null;
	expectedDigest: string | null;
	attestation: {
		url: string;
		network: string;
		signer_pk_hex: string;
		info_digest: string;
		unilateral_exit_delay: string;
	} | null;
}

export const arkStatus: ArkStatus = $state({
	ok: null,
	reason: null,
	receivedDigest: null,
	expectedDigest: null,
	attestation: null
});
