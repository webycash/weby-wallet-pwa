// Webcasa format parsing, decryption, and export.
//
// Webcasa (.webcash files) use CryptoJS AES with OpenSSL EVP_BytesToKey KDF.
// The password is first hashed: sha256hex(password + '_webcasa_salt_rdJpbXdL2YrPHymp')
// then passed to CryptoJS.AES.encrypt which uses EVP_BytesToKey(MD5) internally.

export interface WebcasaWallet {
	master_secret: string;
	webcash: string[];
	walletdepths: Record<string, number>;
}

// ── Parse plaintext webcasa JSON ───────────────────────────────

export const parseWebcasa = (json: string): WebcasaWallet => {
	const data = JSON.parse(json);
	if (typeof data.master_secret !== 'string' || data.master_secret.length < 32)
		throw new Error('Invalid webcasa wallet: missing master_secret');
	return {
		master_secret: data.master_secret,
		webcash: Array.isArray(data.webcash) ? data.webcash.filter((s: unknown) => typeof s === 'string') : [],
		walletdepths: typeof data.walletdepths === 'object' && data.walletdepths !== null
			? Object.fromEntries(Object.entries(data.walletdepths).map(([k, v]) => [k, Number(v)]))
			: {},
	};
};

// ── Detect if raw text is encrypted ────────────────────────────

export const isEncrypted = (raw: string): boolean => {
	try { JSON.parse(raw); return false; } catch { return true; }
};

// ── Decrypt webcasa CryptoJS AES ───────────────────────────────

export const decryptWebcasa = async (raw: string, password: string): Promise<WebcasaWallet> => {
	// Webcasa hashes password before passing to CryptoJS
	const passHash = await sha256hex(password + '_webcasa_salt_rdJpbXdL2YrPHymp');
	// CryptoJS stores as base64(OpenSSL format)
	const bytes = base64Decode(raw.trim());
	// OpenSSL format: "Salted__" (8) + salt (8) + ciphertext
	const header = new TextDecoder().decode(bytes.slice(0, 8));
	if (header !== 'Salted__') throw new Error('Not a CryptoJS encrypted file');
	const salt = bytes.slice(8, 16);
	const ciphertext = bytes.slice(16);
	// EVP_BytesToKey: MD5-based KDF for AES-256-CBC (32 key + 16 IV)
	const { key, iv } = evpBytesToKey(new TextEncoder().encode(passHash), salt, 32, 16);
	// AES-256-CBC decrypt
	const cryptoKey = await crypto.subtle.importKey('raw', key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength), 'AES-CBC', false, ['decrypt']);
	const plainBuf = await crypto.subtle.decrypt(
		{ name: 'AES-CBC', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) },
		cryptoKey,
		ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength),
	);
	// CryptoJS uses PKCS7 padding which Web Crypto strips automatically
	const json = new TextDecoder().decode(plainBuf);
	return parseWebcasa(json);
};

// ── Export as webcasa-compatible JSON ───────────────────────────

export const toWebcasaJson = (masterSecret: string, webcash: string[], depths: Record<string, number>): string => {
	const data = {
		version: '1.0',
		legalese: { terms: true },
		webcash,
		unconfirmed: [],
		log: [],
		master_secret: masterSecret,
		walletdepths: {
			RECEIVE: depths['RECEIVE'] ?? 0,
			PAY: depths['PAY'] ?? 0,
			CHANGE: depths['CHANGE'] ?? 0,
			MINING: depths['MINING'] ?? 0,
		},
	};
	return JSON.stringify(data, null, 4);
};

// ── SHA-256 hex helper ─────────────────────────────────────────

const sha256hex = async (input: string): Promise<string> => {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// ── Base64 decode ──────────────────────────────────────────────

const base64Decode = (s: string): Uint8Array => {
	const bin = atob(s);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
};

// ── EVP_BytesToKey (OpenSSL KDF used by CryptoJS) ──────────────
// D_0 = empty, D_i = MD5(D_{i-1} || password || salt)
// Concatenate D_1..D_n until keyLen + ivLen bytes.

const evpBytesToKey = (password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, keyLen: number, ivLen: number): { key: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer> } => {
	const totalLen = keyLen + ivLen;
	const result = new Uint8Array(totalLen);
	let filled = 0;
	let prev = new Uint8Array(0);
	while (filled < totalLen) {
		const input = new Uint8Array(prev.length + password.length + salt.length);
		input.set(prev, 0);
		input.set(password, prev.length);
		input.set(salt, prev.length + password.length);
		prev = md5(input);
		const copyLen = Math.min(prev.length, totalLen - filled);
		result.set(prev.slice(0, copyLen), filled);
		filled += copyLen;
	}
	return { key: result.slice(0, keyLen), iv: result.slice(keyLen) };
};

// ── Minimal MD5 (needed for EVP_BytesToKey — Web Crypto lacks MD5) ──

const md5 = (msg: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
	const padded = md5Pad(msg);
	let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
	const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
	for (let i = 0; i < padded.length; i += 64) {
		const M = (j: number) => view.getUint32(i + j * 4, true);
		let aa = a, bb = b, cc = c, dd = d;
		for (let j = 0; j < 64; j++) {
			let f: number, g: number;
			if (j < 16)      { f = (bb & cc) | (~bb & dd); g = j; }
			else if (j < 32) { f = (dd & bb) | (~dd & cc); g = (5 * j + 1) % 16; }
			else if (j < 48) { f = bb ^ cc ^ dd;           g = (3 * j + 5) % 16; }
			else              { f = cc ^ (bb | ~dd);        g = (7 * j) % 16; }
			const temp = dd;
			dd = cc; cc = bb;
			bb = (bb + rotl(((aa + f + MD5_K[j] + M(g)) & 0xFFFFFFFF) >>> 0, MD5_S[j])) >>> 0;
			aa = temp;
		}
		a = (a + aa) >>> 0; b = (b + bb) >>> 0; c = (c + cc) >>> 0; d = (d + dd) >>> 0;
	}
	const out = new Uint8Array(16);
	const ov = new DataView(out.buffer);
	ov.setUint32(0, a, true); ov.setUint32(4, b, true); ov.setUint32(8, c, true); ov.setUint32(12, d, true);
	return out;
};

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

const md5Pad = (msg: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
	const bitLen = msg.length * 8;
	const padLen = (56 - (msg.length + 1) % 64 + 64) % 64;
	const buf = new Uint8Array(msg.length + 1 + padLen + 8);
	buf.set(msg);
	buf[msg.length] = 0x80;
	const view = new DataView(buf.buffer);
	view.setUint32(buf.length - 8, bitLen & 0xFFFFFFFF, true);
	view.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000), true);
	return buf;
};

/* eslint-disable */
const MD5_K = [
	0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
	0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
	0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
	0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
	0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
	0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
	0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
	0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391,
];
const MD5_S = [
	7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
	5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
	4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
	6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21,
];
/* eslint-enable */
