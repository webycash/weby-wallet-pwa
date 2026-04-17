// Encryption — WebAuthn passkey + password (Web Crypto API).
// Layer 2 only: encrypts wallet data export blob, not raw database.

import type { WalletSnapshot } from './types';

// ── Password Encryption (PBKDF2 + AES-256-GCM via Web Crypto) ───

export const encryptWithPassword = async (data: WalletSnapshot, password: string): Promise<string> => {
	const plaintext = new TextEncoder().encode(JSON.stringify(data));
	const salt = crypto.getRandomValues(new Uint8Array(32));
	const nonce = crypto.getRandomValues(new Uint8Array(12));

	const keyMaterial = await crypto.subtle.importKey(
		'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
	);
	const key = await crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
		keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
	);
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce }, key, plaintext
	));

	return JSON.stringify({
		ciphertext: Array.from(ciphertext),
		nonce: Array.from(nonce),
		salt: Array.from(salt),
		algorithm: 'AES-256-GCM-PASSWORD',
		kdf_params: { info: 'webycash-password-v1', iterations: 100000, memory_cost: 0, parallelism: 1 },
		metadata: {
			encrypted_at: Math.floor(Date.now() / 1000).toString(),
			platform: 'web-crypto',
			version: '1.0',
			passkey_type: null
		}
	});
};

export const decryptWithPassword = async (encryptedJson: string, password: string): Promise<WalletSnapshot> => {
	const data = JSON.parse(encryptedJson);
	if (data.algorithm !== 'AES-256-GCM-PASSWORD') throw new Error('wrong decryption method');

	const salt = new Uint8Array(data.salt);
	const nonce = new Uint8Array(data.nonce);
	const ciphertext = new Uint8Array(data.ciphertext);

	const keyMaterial = await crypto.subtle.importKey(
		'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
	);
	const key = await crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
		keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
	);
	const plaintext = new Uint8Array(await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: nonce }, key, ciphertext
	));
	return JSON.parse(new TextDecoder().decode(plaintext));
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
