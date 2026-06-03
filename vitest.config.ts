import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Standalone vitest config. We deliberately do NOT pull in the SvelteKit
// plugin here: the unit suite covers pure `.ts` logic (pair policy, book math,
// fee split, push-hook dedupe, trade timeline, facade single-flight) which
// needs no DOM and no rune compilation. `$state` runes live only in
// `*.svelte.ts` reactive wrappers, which are intentionally not unit-tested —
// they delegate to the pure modules that are.
export default defineConfig({
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
