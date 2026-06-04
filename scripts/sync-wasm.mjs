// Copy the built extro-node WASM package into the PWA source tree so Vite can
// bundle it. Run before dev/build: `npm run sync:wasm` (wired as pre{dev,build}).
//
// Source of truth is `extro/extro-node/pkg/` (built by `wasm-pack build --target
// web` in that crate). This script NEVER runs cargo — it only copies an already
// built artifact. If the artifact is missing it prints the exact build command
// and exits non-zero.
//
// The bundled extro-node adapter (src/lib/extro/bundled-node.ts) loads the
// copied module via the `$node` alias; the codec exports
// (extro_encode_command / extro_decode_response) plus extro_node_boot /
// extro_node_send make the bundled wallet adapter REAL (not a mock).
import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../extro/extro-node/pkg');
const dest = resolve(here, '../src/lib/node/pkg');

const files = [
	'extro_node.js',
	'extro_node.d.ts',
	'extro_node_bg.wasm',
	'extro_node_bg.wasm.d.ts',
	'package.json'
];

try {
	await access(resolve(src, 'extro_node_bg.wasm'));
} catch {
	console.error(
		`[sync-wasm] no built WASM at ${src}.\n` +
			`  Build it first (one cargo at a time — check the OOM ps-guard):\n` +
			`    (cd extro/extro-node && wasm-pack build --target web --out-dir pkg)`
	);
	process.exit(1);
}

await mkdir(dest, { recursive: true });
for (const f of files) {
	await cp(resolve(src, f), resolve(dest, f));
}
console.log(`[sync-wasm] copied ${files.length} files → src/lib/node/pkg`);
