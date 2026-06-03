import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Standalone vitest config. The bulk of the suite covers pure `.ts` logic (pair
// policy, book math, fee split, push-hook dedupe, trade timeline, facade
// single-flight). The Svelte plugin is included so the rune-bearing navigation
// store (`navigation.svelte.ts`, a `.svelte.ts` module that compiles `$state`
// and imports `@lucide/svelte` icon components) can be imported and unit-tested
// directly — the menu-as-data model is the navigation contract and is covered
// here. The plugin only transforms Svelte files; pure `.ts` tests are untouched.
export default defineConfig({
	plugins: [svelte()],
	resolve: { conditions: ['browser'] },
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// The bundled extro-node adapter imports the WASM pkg via the `$wasm`
		// alias; tests never exercise the real WASM path (the mock adapter is the
		// tested default), but the alias must resolve for type/module loading.
		alias: {
			$wasm: resolve(__dirname, 'crates/wallet-wasm/pkg'),
			$lib: resolve(__dirname, 'src/lib')
		}
	}
});
