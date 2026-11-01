import { browser } from '$app/environment';
import { arkStatus } from '$lib/ark/ark-status.svelte';
import { bootWithArkAttestation } from '$lib/ark/boot-attestation';
import { configureExtro } from '$lib/extro';
import { configuredAdapterMode } from '$lib/extro/config';
import { installGateSurface } from '$lib/extro/gate-surface';
import { loadRuntimeConfig } from '$lib/extro/release-config';
import { syncNetworkFromRuntimeConfig } from '$lib/stores/network.svelte';
import { installConfiguredHubBridge } from '@extro/node';

export const ssr = false;
export const prerender = true;

// Select the extro-node adapter once, at app load. In the browser the default
// is the BUNDLED same-realm WASM adapter (real wallet ops via the rkyv codec
// seam); the MOCK adapter is the fallback for unbootable contexts (and is the
// implicit default the facade uses if this never runs, e.g. tests). Honour
// PUBLIC_EXTRO_ADAPTER to force mock/cross-domain when wanted.
export const load = async ({ fetch }) => {
	if (browser) {
		const loaded = await loadRuntimeConfig(fetch);
		syncNetworkFromRuntimeConfig();
		// Money-moving Ark code is reachable only after the live operator matches
		// every pin in this immutable release, including extro-node's canonical
		// info digest (Op::Ark OperatorInfoDigest, checked right after the node
		// boots). Fail-soft: a mismatch disables Ark for this session (visible
		// warning) instead of taking the whole wallet down; Webcash/vouchers keep
		// working.
		const mode = configuredAdapterMode();
		let client = null as ReturnType<typeof configureExtro> | null;
		const config = await bootWithArkAttestation(loaded, (bootConfig) => {
			if (mode === 'bundled') client = configureExtro({ mode: 'bundled', bundled: { bootConfig } });
		});
		// GATE 7-CAP: hub CapToken postMessage listener, answering only the
		// origins this deployment's runtime-config.json lists (none = off).
		const hubBridge = client ? installConfiguredHubBridge(client, config) : null;
		// DEV diagnostic: expose the authoritative app client so it can be probed
		// from the page console (dynamic `import('/src/lib/extro')` resolves to a
		// SEPARATE module instance whose singleton defaults to mock — unusable for
		// inspecting the real bundled client). Remove before ship.
		if ((import.meta.env.DEV || config.deployment === 'development') && client) {
			(window as unknown as { __extro?: unknown }).__extro = client;
			(window as unknown as { __extroHubBridge?: { stop: () => void } | null }).__extroHubBridge =
				hubBridge;
		}
		// STAGING live gates: read-only probes only (never the debug client above).
		installGateSurface(window, client, config, arkStatus);
		// 'cross-domain' needs explicit crossDomain options wired by the caller;
		// leave the facade's lazy mock default in place for it (pre-production).
	}
	return {};
};
