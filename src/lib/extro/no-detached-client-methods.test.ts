import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ExtroClient's methods (send, sendDelegated, boot) use `this`. Passing one
// detached (`const f = client.send`, `x ?? getExtroClient().send`) breaks at
// the first call. Source must call them, wrap them in an arrow, or `.bind`.
const DETACHED = /(getExtroClient\(\)|\b\w*(client|Client|extro|Extro)\w*)\s*\.(send|sendDelegated|boot)\b(?!\s*(\(|\.bind\b|\?\.\())(?=\s*[;,)}\]?:|&]|\s*$)/;
const SRC = join(process.cwd(), 'src');

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		if (statSync(p).isDirectory()) return n === 'node' && dir.endsWith('lib') ? [] : files(p);
		return /\.(ts|svelte)$/.test(n) && !/\.test\.ts$|testkit/.test(n) ? [p] : [];
	});
}

describe('ExtroClient methods are never passed detached', () => {
	it('has no detached send/sendDelegated/boot in app source', () => {
		const hits = files(SRC).flatMap((f) =>
			readFileSync(f, 'utf8')
				.split('\n')
				.map((l, i) => ({ f, i: i + 1, l }))
				.filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l) && DETACHED.test(l))
				.map(({ f, i, l }) => `${f.slice(SRC.length + 1)}:${i}: ${l.trim()}`)
		);
		expect(hits).toEqual([]);
	});
});
