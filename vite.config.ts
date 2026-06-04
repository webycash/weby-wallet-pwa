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
	build: {
		target: 'es2022'
	},
	resolve: {
		alias: {
			'$wasm': resolve(__dirname, 'crates/wallet-wasm/pkg'),
			// Built extro-node WASM, synced from extro/extro-node/pkg by
			// scripts/sync-wasm.mjs (pre{dev,build}). Backs the bundled adapter.
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
