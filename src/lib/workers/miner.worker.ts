// CPU mining Web Worker — testnet only.
// Iterates SHA-256 hashes until leading zero bits >= difficulty.

const hexEncode = (bytes: Uint8Array): string =>
	Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (data: Uint8Array): Promise<Uint8Array> =>
	new Uint8Array(await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer));

const leadingZeroBits = (hash: Uint8Array): number => {
	let bits = 0;
	for (const byte of hash) {
		if (byte === 0) { bits += 8; continue; }
		bits += Math.clz32(byte) - 24;
		break;
	}
	return bits;
};

const deriveSecret = async (masterHex: string, chainCode: number, depth: number): Promise<string> => {
	const enc = new TextEncoder();
	const tag = await sha256(enc.encode('webcashwalletv1'));
	const master = new Uint8Array(masterHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
	const chainBe = new Uint8Array(8);
	new DataView(chainBe.buffer).setBigUint64(0, BigInt(chainCode));
	const depthBe = new Uint8Array(8);
	new DataView(depthBe.buffer).setBigUint64(0, BigInt(depth));

	const input = new Uint8Array(tag.length * 2 + master.length + 16);
	let off = 0;
	input.set(tag, off); off += tag.length;
	input.set(tag, off); off += tag.length;
	input.set(master, off); off += master.length;
	input.set(chainBe, off); off += 8;
	input.set(depthBe, off);

	return hexEncode(await sha256(input));
};

self.onmessage = async (e: MessageEvent) => {
	const { masterSecret, miningDepth, difficulty, miningAmount } = e.data;
	const enc = new TextEncoder();

	const secret = await deriveSecret(masterSecret, 3, miningDepth); // MINING chain = 3
	let nonce = 0;
	let lastReport = performance.now();
	let hashCount = 0;

	const mine = async () => {
		while (true) {
			const preimage = `${secret}:${nonce}`;
			const hash = await sha256(enc.encode(preimage));

			hashCount++;
			nonce++;

			if (leadingZeroBits(hash) >= difficulty) {
				const hashHex = hexEncode(hash);
				self.postMessage({
					type: 'found',
					preimage,
					hash: hashHex,
					webcash: `e${miningAmount}:secret:${secret}`,
					nonce
				});
				return;
			}

			// Report progress every ~500ms
			const now = performance.now();
			if (now - lastReport >= 500) {
				const elapsed = (now - lastReport) / 1000;
				self.postMessage({ type: 'progress', hashRate: Math.round(hashCount / elapsed), nonce });
				hashCount = 0;
				lastReport = now;

				// Yield to prevent browser from killing the worker
				await new Promise(r => setTimeout(r, 0));
			}
		}
	};

	mine();
};
