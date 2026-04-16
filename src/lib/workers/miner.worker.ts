// CPU mining Web Worker — testnet only.
// Reports real-time stats: hash rate, attempts, solutions, ETA.

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
	if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
	return `${(seconds / 86400).toFixed(1)}d`;
};

self.onmessage = async (e: MessageEvent) => {
	const { masterSecret, miningDepth, difficulty, miningAmount } = e.data;
	const enc = new TextEncoder();

	const secret = await deriveSecret(masterSecret, 3, miningDepth);
	let nonce = 0;
	let totalAttempts = 0;
	let solutionsFound = 0;
	const startTime = performance.now();
	let lastReport = startTime;
	let hashCount = 0;

	const mine = async () => {
		while (true) {
			const preimage = `${secret}:${nonce}`;
			const hash = await sha256(enc.encode(preimage));

			hashCount++;
			totalAttempts++;
			nonce++;

			if (leadingZeroBits(hash) >= difficulty) {
				solutionsFound++;
				const hashHex = hexEncode(hash);
				const elapsed = (performance.now() - startTime) / 1000;
				const avgRate = Math.round(totalAttempts / elapsed);

				self.postMessage({
					type: 'found',
					preimage,
					hash: hashHex,
					webcash: `e${miningAmount}:secret:${secret}`,
					nonce,
					stats: {
						hashRate: avgRate,
						totalAttempts,
						solutionsFound,
						difficulty,
						uptimeSecs: Math.round(elapsed),
					}
				});
				return;
			}

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
					hashRate: currentRate,
					stats: {
						hashRate: currentRate,
						totalAttempts,
						solutionsFound,
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
