// Canonical browser boundary for the value-free Ark swap prepare handshake.
//
// The two parties exchange their `Signed<PrepareTerms>` bytes over the directed
// DHTX settle plane. Either party may assemble the byte-identical signatures,
// POST them to `/v1/swap/prepare`, and relay the signed response. The response is
// trusted only after extro-node opens it with the runtime-pinned referee key.

import { getExtroClient } from '$lib/extro';
import {
	newRequestId,
	type ArkPrepareExpectation,
	type ArkPrepareTerms
} from '$lib/extro/commands';
import type { RefereeClient } from './referee-client';
import type { PreparedSwapBinding } from './swap-facts';

export interface SignedSwapPrepare {
	signed: Uint8Array;
	requestCommitment: Uint8Array;
}

export interface VerifiedPreparedSwap extends PreparedSwapBinding {
	/** Referee-signed bytes to relay unchanged to the counterparty over DHTX. */
	signedResponse: Uint8Array;
	refereeMusig2Pubshare: string;
	refereeSettleNoncePub: string;
	refereeRefundNoncePub: string;
}

export interface SwapPrepareInbox {
	providerSigned: Uint8Array | null;
	bearerSellerSigned: Uint8Array | null;
	signedResponse: Uint8Array | null;
}

const exactBytes = (value: Uint8Array, length: number, name: string): Uint8Array => {
	if (!(value instanceof Uint8Array) || value.length !== length) {
		throw new Error(`${name} must be exactly ${length} bytes`);
	}
	if (value.every((byte) => byte === 0)) throw new Error(`${name} must not be all zero`);
	return value.slice();
};

/** Sign the exact prepare terms with the named wallet identity. */
export async function signSwapPrepare(
	terms: ArkPrepareTerms,
	slot = 0
): Promise<SignedSwapPrepare> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: { kind: 'Scheme402', cmd: { op: 'SignSwapPrepare', slot, terms } }
	});
	if (response.kind === 'Err') throw new Error(`SignSwapPrepare: ${response.message}`);
	if (response.body.kind !== 'SwapPrepareSigned') {
		throw new Error(`SignSwapPrepare: unexpected ${response.body.kind}`);
	}
	return {
		signed: response.body.signed.slice(),
		requestCommitment: exactBytes(response.body.request_commitment, 32, 'request commitment')
	};
}

/** Verify the other named party's signature and sign the exact same body. */
export async function countersignSwapPrepare(
	counterpartySigned: Uint8Array,
	expected: ArkPrepareExpectation,
	slot = 0
): Promise<SignedSwapPrepare> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Scheme402',
			cmd: {
				op: 'CountersignSwapPrepare',
				slot,
				counterparty_signed: counterpartySigned,
				expected
			}
		}
	});
	if (response.kind === 'Err') throw new Error(`CountersignSwapPrepare: ${response.message}`);
	if (response.body.kind !== 'SwapPrepareSigned') {
		throw new Error(`CountersignSwapPrepare: unexpected ${response.body.kind}`);
	}
	return {
		signed: response.body.signed.slice(),
		requestCommitment: exactBytes(response.body.request_commitment, 32, 'request commitment')
	};
}

/** Send one canonical party authorization over the signed DHTX settle plane. */
export async function relaySwapPrepareSignature(input: {
	orderId: Uint8Array;
	forFingerprint: Uint8Array;
	role: 'Provider' | 'BearerSeller';
	signedPrepare: Uint8Array;
	slot?: number;
}): Promise<boolean> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: {
				op: 'SendSwapPrepareSignature',
				slot: input.slot ?? 0,
				order_id: exactBytes(input.orderId, 16, 'order id'),
				for_fp: exactBytes(input.forFingerprint, 20, 'counterparty fingerprint'),
				role: input.role,
				signed_prepare: input.signedPrepare
			}
		}
	});
	if (response.kind === 'Err') throw new Error(`SendSwapPrepareSignature: ${response.message}`);
	if (response.body.kind !== 'SwapMsgSent') {
		throw new Error(`SendSwapPrepareSignature: unexpected ${response.body.kind}`);
	}
	return response.body.delivered;
}

/** Send a locally verified referee allocation to the counterparty over DHTX. */
export async function relaySwapPrepared(input: {
	orderId: Uint8Array;
	forFingerprint: Uint8Array;
	signedResponse: Uint8Array;
	refereeVk: Uint8Array;
	expectedRequestCommitment: Uint8Array;
	slot?: number;
}): Promise<boolean> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: {
				op: 'SendSwapPrepared',
				slot: input.slot ?? 0,
				order_id: exactBytes(input.orderId, 16, 'order id'),
				for_fp: exactBytes(input.forFingerprint, 20, 'counterparty fingerprint'),
				signed_response: input.signedResponse,
				referee_vk: exactBytes(input.refereeVk, 32, 'referee verifying key'),
				expected_request_commitment: exactBytes(
					input.expectedRequestCommitment,
					32,
					'request commitment'
				)
			}
		}
	});
	if (response.kind === 'Err') throw new Error(`SendSwapPrepared: ${response.message}`);
	if (response.body.kind !== 'SwapMsgSent') {
		throw new Error(`SendSwapPrepared: unexpected ${response.body.kind}`);
	}
	return response.body.delivered;
}

/** Drain DHTX and return only the three opaque prepare artifacts for an order. */
export async function fetchSwapPrepareInbox(orderId: Uint8Array): Promise<SwapPrepareInbox> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Dhtx',
			cmd: { op: 'FetchSwapMsgs', order_id: exactBytes(orderId, 16, 'order id') }
		}
	});
	if (response.kind === 'Err') throw new Error(`FetchSwapMsgs: ${response.message}`);
	if (response.body.kind !== 'SwapMsgs') {
		throw new Error(`FetchSwapMsgs: unexpected ${response.body.kind}`);
	}
	return {
		providerSigned: response.body.provider_prepare?.slice() ?? null,
		bearerSellerSigned: response.body.bearer_seller_prepare?.slice() ?? null,
		signedResponse: response.body.prepared_response?.slice() ?? null
	};
}

/** Assemble the two signatures; extro-node rejects non-identical signed bodies. */
export async function buildSwapPrepareEnvelope(
	providerSigned: Uint8Array,
	bearerSellerSigned: Uint8Array
): Promise<Uint8Array> {
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Scheme402',
			cmd: {
				op: 'BuildSwapPrepareRequest',
				provider_signed: providerSigned,
				bearer_seller_signed: bearerSellerSigned
			}
		}
	});
	if (response.kind === 'Err') throw new Error(`BuildSwapPrepareRequest: ${response.message}`);
	if (response.body.kind !== 'SwapPrepareEnvelope') {
		throw new Error(`BuildSwapPrepareRequest: unexpected ${response.body.kind}`);
	}
	return response.body.bytes.slice();
}

/**
 * Allocate signer sessions at the referee, then verify the signed allocation
 * against the pinned referee identity before exposing its Ark public nonces.
 */
export async function submitAndVerifySwapPrepare(input: {
	referee: RefereeClient;
	envelope: Uint8Array;
	refereeVk: Uint8Array;
	expectedRequestCommitment: Uint8Array;
	idempotencyKey: Uint8Array;
	nowUnix?: number;
}): Promise<VerifiedPreparedSwap> {
	const expected = exactBytes(input.expectedRequestCommitment, 32, 'request commitment');
	const idempotencyKey = exactBytes(input.idempotencyKey, 16, 'idempotency key');
	const signedResponse = await input.referee.prepare(input.envelope);
	const response = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Scheme402',
			cmd: {
				op: 'VerifySwapPrepared',
				signed_response: signedResponse,
				referee_vk: exactBytes(input.refereeVk, 32, 'referee verifying key'),
				expected_request_commitment: expected,
				now_unix: input.nowUnix ?? Math.floor(Date.now() / 1000)
			}
		}
	});
	if (response.kind === 'Err') throw new Error(`VerifySwapPrepared: ${response.message}`);
	if (response.body.kind !== 'SwapPrepared') {
		throw new Error(`VerifySwapPrepared: unexpected ${response.body.kind}`);
	}
	return {
		swapId: response.body.swap_id,
		requestCommitment: exactBytes(response.body.request_commitment, 32, 'request commitment'),
		idempotencyKey,
		expiresAtUnix: response.body.expires_at_unix,
		signedResponse: signedResponse.slice(),
		refereeMusig2Pubshare: response.body.referee_musig2_pubshare,
		refereeSettleNoncePub: response.body.referee_settle_nonce_pub,
		refereeRefundNoncePub: response.body.referee_refund_nonce_pub
	};
}
