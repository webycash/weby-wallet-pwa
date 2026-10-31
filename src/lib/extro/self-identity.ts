// Self identity (fingerprint + Ed25519 verifying key) for a wallet slot.
//
// extro-node's `DeriveIdentity` registers the slot identity and errors on a
// repeat call for the same slot ("identity slot N already registered"). The
// connection bootstrap derives slot 0 first, so every later caller (exchange
// responder, swap protocol, Accept→prepare) must reuse that result. We memoize
// per slot and, when the registry already holds the slot, fall back to the
// read-only `SignAttestation` op, which returns the same public material
// without touching the registry. Only public data is cached; the key never
// leaves the WASM. Cleared on lock via {@link clearSelfIdentity}.

import type { ExtroClient } from '@extro/node';
import { newRequestId } from '@extro/node';

export interface SelfIdentity {
	fingerprintHex: string;
	verifyingKey: Uint8Array;
	slot: number;
}

const cache = new Map<number, SelfIdentity>();
const PROBE = new TextEncoder().encode('extro-self-identity-probe');

export function rememberSelfIdentity(id: SelfIdentity): void {
	cache.set(id.slot, { ...id, fingerprintHex: id.fingerprintHex.toLowerCase() });
}

export function clearSelfIdentity(): void {
	cache.clear();
}

export async function getSelfIdentity(client: ExtroClient, slot = 0): Promise<SelfIdentity> {
	const hit = cache.get(slot);
	if (hit) return hit;
	const derived = await client.send({
		request_id: newRequestId(),
		op: { kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot } }
	});
	if (derived.kind === 'Ok' && derived.body.kind === 'Identity') {
		const id = {
			fingerprintHex: derived.body.fingerprint_hex.toLowerCase(),
			verifyingKey: derived.body.verifying_key,
			slot
		};
		rememberSelfIdentity(id);
		return id;
	}
	const deriveErr = derived.kind === 'Err' ? `${derived.code}: ${derived.message}` : `unexpected ${derived.body.kind}`;
	// Already registered (or any other non-lock failure): read-only fallback.
	const att = await client.send({
		request_id: newRequestId(),
		op: { kind: 'Wallet', cmd: { op: 'SignAttestation', slot, payload: PROBE } }
	});
	if (att.kind === 'Ok' && att.body.kind === 'Attestation') {
		const id = {
			fingerprintHex: att.body.fingerprint_hex.toLowerCase(),
			verifyingKey: att.body.verifying_key,
			slot
		};
		rememberSelfIdentity(id);
		return id;
	}
	const attErr = att.kind === 'Err' ? `${att.code}: ${att.message}` : `unexpected ${att.body.kind}`;
	throw new Error(`self identity unavailable (DeriveIdentity: ${deriveErr}; SignAttestation: ${attErr})`);
}
