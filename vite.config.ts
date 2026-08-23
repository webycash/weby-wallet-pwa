import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { compression } from 'vite-plugin-compression2';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		wasm(),
		topLevelAwait(),
		sveltekit(),
		compression({ algorithms: ['gzip', 'brotliCompress'], include: /\.(js|css|html|wasm|json|svg)$/ }),
	],
	// The prover web worker (src/lib/extro/prover.ts) dynamically imports the
	// extro-node WASM, so it is a code-splitting worker — which requires the ES
	// module format (the vite default 'iife' rejects code-splitting). The worker
	// also needs the wasm + top-level-await plugins to load the .wasm itself.
	worker: {
		format: 'es',
		plugins: () => [wasm(), topLevelAwait()]
	},
	build: {
		target: 'es2022'
	},
	resolve: {
		alias: {
			'$wasm': resolve(__dirname, 'crates/wallet-wasm/pkg'),
			// Release-pinned extro-node WASM. Its source commit and hashes are
			// recorded in wasm-artifacts.json and verified before every build.
			'$node': resolve(__dirname, 'src/lib/node/pkg')
		}
	},
	server: {
		fs: {
			allow: [
				resolve(__dirname, 'crates/wallet-wasm/pkg'),
				resolve(__dirname, 'src/lib/node/pkg')
			]
		}
	},
	optimizeDeps: {
		exclude: ['$wasm', '$node']
	}
});
