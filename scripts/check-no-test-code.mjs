// Build-time guard (audit M8): production source must not contain or import
// mocks/fixtures. Test doubles live under src/test/ and are only imported by
// *.test.ts / *.spec.ts files. Run as `node scripts/check-no-test-code.mjs`
// (wired into `prebuild`) or import `findTestCodeViolations()` from a test.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXT = new Set(['.ts', '.js', '.mjs', '.svelte']);
const TEST_FILE = /\.(test|spec)\.(ts|js|mjs)$/;
const TEST_ONLY_NAME = /(^|[-_.])(mock|mocks|fixture|fixtures)([-_.]|$)/i;
const IMPORT_RE = /(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

/** @param {string} dir @returns {Promise<string[]>} */
async function walk(dir) {
	/** @type {string[]} */
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(path)));
		else if (SOURCE_EXT.has(extname(entry.name))) out.push(path);
	}
	return out;
}

/** @param {string} root @returns {Promise<string[]>} human-readable violations (empty = clean). */
export async function findTestCodeViolations(root) {
	const src = resolve(root, 'src');
	const testDir = resolve(src, 'test') + sep;
	const lib = resolve(src, 'lib');
	const violations = [];
	for (const file of await walk(src)) {
		const rel = relative(root, file);
		if (file.startsWith(testDir) || TEST_FILE.test(file)) continue;
		const base = file.slice(file.lastIndexOf(sep) + 1).replace(/\.(svelte\.)?(ts|js|mjs|svelte)$/, '');
		if (TEST_ONLY_NAME.test(base)) violations.push(`${rel}: mock/fixture module outside src/test/`);
		const text = await readFile(file, 'utf8');
		for (const m of text.matchAll(IMPORT_RE)) {
			const spec = m[1] ?? m[2] ?? m[3];
			let target = null;
			if (spec.startsWith('.')) target = resolve(dirname(file), spec);
			else if (spec.startsWith('$lib/')) target = resolve(lib, spec.slice(5));
			else if (spec === '$lib') target = lib;
			if (!target) continue;
			const leaf = target.slice(target.lastIndexOf(sep) + 1).replace(/\.(svelte\.)?(ts|js|mjs|svelte)$/, '');
			if ((target + sep).startsWith(testDir) || TEST_ONLY_NAME.test(leaf)) {
				violations.push(`${rel}: imports test-only module '${spec}'`);
			}
		}
	}
	return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const violations = await findTestCodeViolations(root);
	if (violations.length) {
		console.error(`[check-no-test-code] FAIL:\n${violations.join('\n')}`);
		process.exit(1);
	}
	console.log('[check-no-test-code] PASS: no mocks/fixtures in production source');
}
