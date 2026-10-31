// Paid keyserver identity registration (browser product path).
//
// The in-browser extro-node has no native rail actors, so the PWA wallet
// settles the registration fee itself: `payWebcash` replaces a slice of the
// wallet's balance into a FRESH single-use output of exactly the fee amount
// and hands that bearer secret to the node's `Keyserver/Register` command.
// The node fetches + verifies the signed challenge against the pinned
// keyserver anchor, signs the retry with the slot-0 identity key (which never
// leaves WASM) and verifies the signed receipt. The bearer secret is never
// logged or persisted by this module; if registration fails before the
// keyserver redeems it, it is re-inserted so the fee is not lost.

import { getExtroClient } from './index';
import { isOk, newRequestId } from '@extro/node';
import { getRuntimeConfig } from '$lib/extro/release-config';
import { getSelfIdentity } from './self-identity';
import { payWebcash, insertWebcash, parseAmount } from '$lib/stores/wallet.svelte';

/** Registration fee advertised by the keyserver's 402 challenge (webcash units). */
export const REGISTRATION_FEE = '0.0001';

export interface IdentityRegistration {
	fingerprint_hex: string;
	nickname: string;
	registered_at_unix: number;
}

const REGISTERED_KEY = 'extro_identity_registered_v1';

/**
 * Whether THIS browser completed a registration for `fingerprintHex`.
 * Client transport is WebRTC-only (ADR-0001): the PWA never queries the
 * keyserver's HTTP record API itself; the node's signed receipt is the proof
 * and only its non-secret summary is remembered here.
 */
export function isIdentityRegistered(fingerprintHex: string): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		const map = JSON.parse(localStorage.getItem(REGISTERED_KEY) ?? '{}') as Record<string, unknown>;
		return Boolean(map[fingerprintHex.toLowerCase()]);
	} catch {
		return false;
	}
}

function rememberRegistered(r: IdentityRegistration): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const map = JSON.parse(localStorage.getItem(REGISTERED_KEY) ?? '{}') as Record<string, unknown>;
		map[r.fingerprint_hex.toLowerCase()] = { nickname: r.nickname, at: r.registered_at_unix };
		localStorage.setItem(REGISTERED_KEY, JSON.stringify(map));
	} catch {
		// Storage unavailable: the keyserver record is still authoritative.
	}
}

/** Pay the fee from the active webcash wallet and register the slot-0 identity. */
export async function registerExtroIdentity(nickname: string): Promise<IdentityRegistration> {
	const cfg = getRuntimeConfig();
	const client = getExtroClient();
	const self = await getSelfIdentity(client, 0);
	if (isIdentityRegistered(self.fingerprintHex)) {
		throw new Error(`identity ${self.fingerprintHex} is already registered`);
	}
	const pinned = await client.send({
		request_id: newRequestId(),
		op: {
			kind: 'Keyserver',
			cmd: {
				op: 'Pin',
				base_url: cfg.keyserver_url,
				domain: cfg.keyserver_domain,
				fingerprint_hex: cfg.keyserver_fingerprint_hex,
				vk_hex: cfg.keyserver_vk_hex
			}
		}
	});
	if (!isOk(pinned)) throw new Error(`${pinned.code}: ${pinned.message}`);

	const feeWats = await parseAmount(REGISTRATION_FEE);
	const paid = await payWebcash(feeWats);
	if (!paid.ok) throw new Error(paid.error);
	const res = await client.send({
		request_id: newRequestId(),
		op: {
			kind: 'Keyserver',
			cmd: {
				op: 'Register',
				base_url: cfg.keyserver_url,
				domain: cfg.keyserver_domain,
				nickname,
				rail: 'webcash',
				bearer_secret: paid.value
			}
		}
	});
	if (!isOk(res) || res.body.kind !== 'IdentityRegistered') {
		// Recover the fee if the keyserver did not redeem it (insert fails
		// harmlessly when it already did).
		await insertWebcash(paid.value);
		if (!isOk(res)) throw new Error(`${res.code}: ${res.message}`);
		throw new Error(`expected IdentityRegistered, received ${res.body.kind}`);
	}
	const registered = {
		fingerprint_hex: res.body.fingerprint_hex,
		nickname: res.body.nickname,
		registered_at_unix: res.body.registered_at_unix
	};
	rememberRegistered(registered);
	return registered;
}
