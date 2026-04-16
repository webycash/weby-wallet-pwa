// Pure TypeScript implementations of webylib-wasm exports.
// Produces identical output to the Rust WASM module.
// Used during development; replaced by @webycash/webylib-wasm in production.

const DECIMALS = 8;
const UNIT = 100_000_000;

// ── SHA-256 via Web Crypto ───────────────────────────────────────

async function sha256bytes(data: Uint8Array): Promise<Uint8Array> {
	const buf = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
	return new Uint8Array(buf);
}

function hexEncode(bytes: Uint8Array): string {
	return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

// ── Exports (match webylib-wasm API) ─────────────────────────────

export async function generate_master_secret(): Promise<string> {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return hexEncode(bytes);
}

// HD derivation: SHA256(tag || tag || master || chain_be64 || depth_be64)
export async function derive_secret(masterHex: string, chainCode: number, depth: number): Promise<string> {
	const enc = new TextEncoder();
	const tag = await sha256bytes(enc.encode('webcashwalletv1'));
	const master = hexDecode(masterHex);

	const chainBe = new Uint8Array(8);
	new DataView(chainBe.buffer).setBigUint64(0, BigInt(chainCode));

	const depthBe = new Uint8Array(8);
	new DataView(depthBe.buffer).setBigUint64(0, BigInt(depth));

	const input = new Uint8Array(tag.length + tag.length + master.length + 8 + 8);
	let offset = 0;
	input.set(tag, offset); offset += tag.length;
	input.set(tag, offset); offset += tag.length;
	input.set(master, offset); offset += master.length;
	input.set(chainBe, offset); offset += 8;
	input.set(depthBe, offset);

	const hash = await sha256bytes(input);
	return hexEncode(hash);
}

export async function sha256_hex(data: string): Promise<string> {
	const enc = new TextEncoder();
	const hash = await sha256bytes(enc.encode(data));
	return hexEncode(hash);
}

export async function secret_to_public(secret: string): Promise<string> {
	return sha256_hex(secret);
}

export function format_amount(wats: number): string {
	if (wats === 0) return '0';
	const integer = Math.floor(wats / UNIT);
	const frac = Math.abs(wats % UNIT);
	if (frac === 0) return `${integer}`;
	const fracStr = frac.toString().padStart(DECIMALS, '0').replace(/0+$/, '');
	return `${integer}.${fracStr}`;
}

export function parse_amount(s: string): number {
	let str = s.trim();
	if (str.startsWith('e')) str = str.slice(1);
	if (str === '0') return 0;

	const parts = str.split('.');
	if (parts.length > 2) throw new Error('too many decimal points');

	const intPart = parts[0] ? parseInt(parts[0], 10) : 0;
	if (isNaN(intPart)) throw new Error('invalid integer part');

	if (parts.length === 1) return intPart * UNIT;

	const fracStr = parts[1];
	if (fracStr.length > DECIMALS) throw new Error('too many decimal places');

	const fracVal = parseInt(fracStr, 10);
	const multiplier = Math.pow(10, DECIMALS - fracStr.length);
	return intPart * UNIT + fracVal * multiplier;
}

export function parse_webcash(s: string): { secret: string; amount_wats: number; amount_display: string } {
	const trimmed = s.trim();
	if (!trimmed.startsWith('e')) throw new Error("webcash must start with 'e'");

	const parts = trimmed.slice(1).split(':');
	if (parts.length < 3 || parts[1] !== 'secret') throw new Error('invalid webcash format');

	const wats = parse_amount(parts[0]);
	const secret = parts.slice(2).join(':');
	if (secret.length !== 64) throw new Error('secret must be 64 hex chars');
	if (!/^[0-9a-f]+$/i.test(secret)) throw new Error('secret must be valid hex');

	return { secret, amount_wats: wats, amount_display: format_amount(wats) };
}

export function format_webcash(secret: string, amountWats: number): string {
	return `e${format_amount(amountWats)}:secret:${secret}`;
}

export function format_public_webcash(hashHex: string, amountWats: number): string {
	return `e${format_amount(amountWats)}:public:${hashHex}`;
}

// Encryption stubs — delegate to Web Crypto API with Argon2 from WASM.
// For the stub, we use PBKDF2 as a placeholder. The real WASM module uses Argon2id.
// WARNING: This is NOT compatible with native webylib encryption.
// Use the actual WASM module for cross-platform compatibility.

export async function encrypt_data(plaintext: Uint8Array, password: string): Promise<string> {
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
		{ name: 'AES-GCM', iv: nonce }, key, plaintext as unknown as ArrayBuffer
	));

	return JSON.stringify({
		ciphertext: Array.from(ciphertext),
		nonce: Array.from(nonce),
		salt: Array.from(salt),
		algorithm: 'AES-256-GCM-PASSWORD',
		kdf_params: { info: 'webycash-password-v1', iterations: 0, memory_cost: 65536, parallelism: 4 },
		metadata: {
			encrypted_at: Math.floor(Date.now() / 1000).toString(),
			platform: 'wasm-stub',
			version: '1.0',
			passkey_type: null
		}
	});
}

export async function decrypt_data(encryptedJson: string, password: string): Promise<Uint8Array> {
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

	return new Uint8Array(await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: nonce }, key, ciphertext
	));
}
