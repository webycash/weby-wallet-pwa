import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const build = resolve(root, 'build');
const extensions = new Set(['.js', '.json', '.html', '.css']);
const prohibited = [
	['localhost URL', /http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i],
	['unresolved deployment placeholder', /REPLACE_ME/],
	['bundled Extro mock adapter', /mock not booted|mock-bearer-secret|mock-public-token|mode\s*=\s*["']mock["']/i],
	['bundled mock referee', /referee_version\s*:\s*["']mock["']|swap_id\s*:\s*`mock-/i],
	['fixture-only provider material', /(?:aa|11|22){16,}/i]
];

async function files(directory) {
	const out = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) out.push(...(await files(path)));
		else if (extensions.has(extname(entry.name))) out.push(path);
	}
	return out;
}

const failures = [];
for (const path of await files(build)) {
	const contents = await readFile(path, 'utf8');
	for (const [label, pattern] of prohibited) {
		if (pattern.test(contents)) failures.push(`${relative(root, path)}: ${label}`);
	}
}

if (failures.length) {
	console.error(`[scan-release] prohibited runtime material found:\n${failures.join('\n')}`);
	process.exit(1);
}

console.log('[scan-release] PASS: no local URLs, placeholders, mock implementations, or fixture provider material');
