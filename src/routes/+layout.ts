import { browser } from '$app/environment';
import { configureExtro } from '$lib/extro';
import { configuredAdapterMode, loadBundledExtroNode } from '$lib/extro/config';

export const ssr = false;
export const prerender = true;

// Select the extro-node adapter once, at app load. In the browser the default
// is the BUNDLED same-realm WASM adapter (real wallet ops via the rkyv codec
// seam); the MOCK adapter is the fallback for unbootable contexts (and is the
// implicit default the facade uses if this never runs, e.g. tests). Honour
// PUBLIC_EXTRO_ADAPTER to force mock/cross-domain when wanted.
export const load = () => {
	if (browser) {
		const mode = configuredAdapterMode();
		if (mode === 'bundled') {
			configureExtro({ mode: 'bundled', bundled: { load: loadBundledExtroNode } });
		} else if (mode === 'mock') {
			configureExtro({ mode: 'mock' });
		}
		// 'cross-domain' needs explicit crossDomain options wired by the caller;
		// leave the facade's lazy mock default in place for it (pre-production).
	}
	return {};
};
