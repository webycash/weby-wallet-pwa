// CPU mining Web Worker — testnet only.
// Builds JSON preimage matching webylib/src/miner.rs exactly.

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

const formatDuration = (seconds: number): string => {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	return `${(seconds / 3600).toFixed(1)}h`;
};

self.onmessage = async (e: MessageEvent) => {
	const { masterSecret, miningDepth, difficulty, miningAmount } = e.data;
	const enc = new TextEncoder();

	// Derive mining secret (same as webylib ChainCode::Mining = 3)
	const secret = await deriveSecret(masterSecret, 3, miningDepth);
	const webcashStr = `e${miningAmount}:secret:${secret}`;

	let nonce = 0;
	let totalAttempts = 0;
	const startTime = performance.now();
	let lastReport = startTime;
	let hashCount = 0;

	const mine = async () => {
		while (true) {
			const timestamp = Math.floor(Date.now() / 1000);

			// Build preimage JSON — MUST match webylib/src/miner.rs format exactly
			const preimage = `{"webcash":["${webcashStr}"],"subsidy":[],"timestamp":${timestamp},"difficulty":${difficulty},"nonce":${nonce}}`;
			const hash = await sha256(enc.encode(preimage));

			hashCount++;
			totalAttempts++;

			if (leadingZeroBits(hash) >= difficulty) {
				const hashHex = hexEncode(hash);
				const elapsed = (performance.now() - startTime) / 1000;

				self.postMessage({
					type: 'found',
					preimage,
					hash: hashHex,
					webcash: webcashStr,
					secret,
					nonce,
					stats: {
						hashRate: Math.round(totalAttempts / elapsed),
						totalAttempts,
						solutionsFound: 1,
						difficulty,
						uptimeSecs: Math.round(elapsed),
					}
				});
				return;
			}

			nonce++;

			const now = performance.now();
			if (now - lastReport >= 400) {
				const elapsed = (now - lastReport) / 1000;
				const currentRate = Math.round(hashCount / elapsed);
				const totalElapsed = (now - startTime) / 1000;
				const avgRate = totalAttempts / totalElapsed;
				const expectedHashes = Math.pow(2, difficulty);
				const remaining = Math.max(0, expectedHashes - totalAttempts);
				const etaSecs = avgRate > 0 ? remaining / avgRate : 0;

				self.postMessage({
					type: 'progress',
					stats: {
						hashRate: currentRate,
						totalAttempts,
						solutionsFound: 0,
						difficulty,
						uptimeSecs: Math.round(totalElapsed),
						eta: formatDuration(etaSecs),
						progress: Math.min(100, (totalAttempts / expectedHashes) * 100),
					}
				});

				hashCount = 0;
				lastReport = now;
				await new Promise(r => setTimeout(r, 0));
			}
		}
	};

	mine();
};
