// Guard: the wallet talks to a webcash rail (`/api/v1/{health_check,replace,burn}`)
// ONLY through extro-node (WASM), which speaks webylib `server_client::wire`
// (CORS-simple text/plain). No shipped TS references a rail endpoint or fetches
// the rail — `webcash-rail-client.ts` dispatches extro-node ops — and nothing
// posts with a JSON content-type (webcash.org CORS preflight rejects it ->
// "Failed to fetch"; regression: mainnet staging d1c bearer reserve).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const HELPER = 'src/lib/core/webcash-rail-client.ts';
const RAIL_PATH = /\/api\/v1\/(?:health_check|replace|burn)\b/;
const JSON_CT = /application\/json/i;

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'pkg' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|js|svelte|mjs)$/.test(name)) out.push(p);
	}
	return out;
}

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'e2e'))].map((p) => ({
	rel: relative(ROOT, p).replaceAll('\\', '/'),
	text: readFileSync(p, 'utf8')
}));
const isTest = (rel: string) => /\.(test|spec)\.ts$/.test(rel);

/** Each rail-endpoint reference with the request options that follow it. */
function railCalls(text: string): string[] {
	const out: string[] = [];
	const re = new RegExp(RAIL_PATH.source, 'g');
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const rest = text.slice(m.index);
		const end = rest.search(/\}\s*\)/);
		out.push(rest.slice(0, end < 0 ? 400 : end + 2));
	}
	return out;
}

describe('webcash rail guard', () => {
	it('no shipped TS references a rail endpoint (extro-node is the only rail client)', () => {
		const offenders = files
			.filter((f) => f.rel.startsWith('src/') && !isTest(f.rel))
			.filter((f) => f.text.split('\n').some((l) => RAIL_PATH.test(l) && !/^\s*(\*|\/\/)/.test(l)))
			.map((f) => f.rel);
		expect(offenders).toEqual([]);
	});

	it('no code (src or e2e) posts to a rail endpoint with a JSON content-type', () => {
		const offenders = files.filter((f) => railCalls(f.text).some((c) => JSON_CT.test(c))).map((f) => f.rel);
		expect(offenders).toEqual([]);
	});

	it('the shared TS client has no transport of its own: it dispatches extro-node ops', () => {
		const helper = files.find((f) => f.rel === HELPER)!.text;
		expect(helper).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|\/api\/v1\//);
		expect(helper).toMatch(/\$lib\/extro\/rail/);
	});

	it('the shipped extro-node WASM has no JSON content-type literal', () => {
		const wasm = readFileSync(join(ROOT, 'src/lib/node/pkg/extro_node_bg.wasm'));
		expect(wasm.includes(Buffer.from('application/json'))).toBe(false);
		// webylib wire's CORS-simple POST content type is compiled in.
		expect(wasm.includes(Buffer.from('text/plain;charset=UTF-8'))).toBe(true);
	});
});
