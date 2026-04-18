import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [wasm(), topLevelAwait(), sveltekit()],
	build: {
		target: 'es2022'
	},
	resolve: {
		alias: {
			'$wasm': resolve(__dirname, 'crates/wallet-wasm/pkg')
		}
	},
	server: {
		fs: {
			allow: [resolve(__dirname, 'crates/wallet-wasm/pkg')]
		}
	},
	optimizeDeps: {
		exclude: ['$wasm']
	}
});
