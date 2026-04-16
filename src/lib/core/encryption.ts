// Encryption — WebAuthn passkey + password (via WASM).
// Layer 2 only: encrypts wallet data export blob, not raw database.

import type { WalletSnapshot } from './types';
import { getWasm } from './wasm';

// ── Password Encryption (Argon2 + AES-256-GCM via WASM) ─────────

export const encryptWithPassword = async (data: WalletSnapshot, password: string): Promise<string> => {
	const wasm = await getWasm();
	const json = JSON.stringify(data);
	const bytes = new TextEncoder().encode(json);
	return wasm.encrypt_data(bytes, password);
};

export const decryptWithPassword = async (encryptedJson: string, password: string): Promise<WalletSnapshot> => {
	const wasm = await getWasm();
	const bytes = await wasm.decrypt_data(encryptedJson, password);
	const json = new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
	return JSON.parse(json);
};

// ── WebAuthn Passkey Encryption ───────────���──────────────────────

export const isWebAuthnAvailable = (): boolean =>
	typeof window !== 'undefined' &&
	typeof window.PublicKeyCredential !== 'undefined' &&
	typeof navigator.credentials !== 'undefined';

export const encryptWithPasskey = async (data: WalletSnapshot): Promise<{
	encrypted: string;
	credentialId: string;
}> => {
	const json = JSON.stringify(data);
	const plaintext = new TextEncoder().encode(json);

	// Create a new credential with PRF extension
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const userId = crypto.getRandomValues(new Uint8Array(16));

	const credential = await navigator.credentials.create({
		publicKey: {
			challenge,
			rp: { name: 'Weby Wallet', id: window.location.hostname },
			user: { id: userId, name: 'weby-wallet', displayName: 'Weby Wallet' },
			pubKeyCredParams: [
				{ alg: -7, type: 'public-key' },   // ES256
				{ alg: -257, type: 'public-key' }   // RS256
			],
			authenticatorSelection: {
				authenticatorAttachment: 'platform',
				residentKey: 'required',
				userVerification: 'required'
			},
			extensions: {
				// @ts-ignore PRF extension not yet in TS types
				prf: { eval: { first: new TextEncoder().encode('weby-wallet-encryption-v1') } }
			}
		}
	}) as PublicKeyCredential;

	if (!credential) throw new Error('Passkey creation failed');

	// Get PRF output for key derivation
	// @ts-ignore PRF extension result
	const prfResult = credential.getClientExtensionResults()?.prf?.results?.first;

	let key: CryptoKey;
	if (prfResult) {
		key = await crypto.subtle.importKey(
			'raw', prfResult, 'AES-GCM', false, ['encrypt']
		);
	} else {
		// Fallback: derive key from credential ID
		const keyMaterial = await crypto.subtle.digest('SHA-256', credential.rawId);
		key = await crypto.subtle.importKey(
			'raw', keyMaterial, 'AES-GCM', false, ['encrypt']
		);
	}

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

	const encrypted = JSON.stringify({
		ciphertext: Array.from(new Uint8Array(ciphertext)),
		iv: Array.from(iv),
		credentialId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
		usedPrf: !!prfResult
	});

	return {
		encrypted,
		credentialId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
	};
};

export const decryptWithPasskey = async (encrypted: string): Promise<WalletSnapshot> => {
	const data = JSON.parse(encrypted);
	const credentialIdBytes = Uint8Array.from(atob(data.credentialId), c => c.charCodeAt(0));

	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const assertion = await navigator.credentials.get({
		publicKey: {
			challenge,
			allowCredentials: [{ id: credentialIdBytes, type: 'public-key' }],
			userVerification: 'required',
			extensions: {
				// @ts-ignore PRF extension
				prf: data.usedPrf
					? { eval: { first: new TextEncoder().encode('weby-wallet-encryption-v1') } }
					: undefined
			}
		}
	}) as PublicKeyCredential;

	if (!assertion) throw new Error('Passkey authentication failed');

	let key: CryptoKey;
	// @ts-ignore PRF extension result
	const prfResult = assertion.getClientExtensionResults()?.prf?.results?.first;

	if (prfResult && data.usedPrf) {
		key = await crypto.subtle.importKey('raw', prfResult, 'AES-GCM', false, ['decrypt']);
	} else {
		const keyMaterial = await crypto.subtle.digest('SHA-256', assertion.rawId);
		key = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['decrypt']);
	}

	const iv = new Uint8Array(data.iv);
	const ciphertext = new Uint8Array(data.ciphertext);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

	return JSON.parse(new TextDecoder().decode(plaintext));
};
