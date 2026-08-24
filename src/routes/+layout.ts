import { browser } from '$app/environment';
import { configureExtro } from '$lib/extro';
import { configuredAdapterMode, loadBundledExtroNode } from '$lib/extro/config';
import { loadRuntimeConfig } from '$lib/extro/runtime-config';

export const ssr = false;
export const prerender = true;

// Select the extro-node adapter once, at app load. In the browser the default
// is the BUNDLED same-realm WASM adapter (real wallet ops via the rkyv codec
// seam); the MOCK adapter is the fallback for unbootable contexts (and is the
// implicit default the facade uses if this never runs, e.g. tests). Honour
// PUBLIC_EXTRO_ADAPTER to force mock/cross-domain when wanted.
export const load = async ({ fetch }) => {
	if (browser) {
		const config = await loadRuntimeConfig(fetch);
		const mode = configuredAdapterMode();
		let client: ReturnType<typeof configureExtro> | null = null;
		if (mode === 'bundled') {
			client = configureExtro({
				mode: 'bundled',
				bundled: { load: loadBundledExtroNode, bootConfig: config }
			});
		}
		// DEV diagnostic: expose the authoritative app client so it can be probed
		// from the page console (dynamic `import('/src/lib/extro')` resolves to a
		// SEPARATE module instance whose singleton defaults to mock — unusable for
		// inspecting the real bundled client). Remove before ship.
		if ((import.meta.env.DEV || config.deployment === 'development') && client) {
			(window as unknown as { __extro?: unknown }).__extro = client;
		}
		// 'cross-domain' needs explicit crossDomain options wired by the caller;
		// leave the facade's lazy mock default in place for it (pre-production).
	}
	return {};
};
