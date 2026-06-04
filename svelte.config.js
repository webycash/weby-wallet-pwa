import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			fallback: 'index.html'
		}),
		paths: {
			base: process.env.BASE_PATH || ''
		},
		alias: {
			// Built extro-node WASM, synced from extro/extro-node/pkg by
			// scripts/sync-wasm.mjs. Mirrors the vite.config $node alias so
			// svelte-check resolves the bundled-adapter import.
			$node: 'src/lib/node/pkg',
			'$node/*': 'src/lib/node/pkg/*'
		}
	}
};

export default config;
