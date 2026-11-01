import { browser } from '$app/environment';
import { arkStatus } from '$lib/ark/ark-status.svelte';
import { bootWithArkAttestation } from '$lib/ark/boot-attestation';
import { configureExtro } from '$lib/extro';
import { configuredAdapterMode } from '$lib/extro/config';
import { installGateSurface } from '$lib/extro/gate-surface';
import { loadRuntimeConfig } from '$lib/extro/release-config';
import { homeRoute, MOVE_DEFER_KEY, MOVE_NEXT_KEY } from '$lib/core/wallet-home-route';
import { readMovedTo } from '$lib/core/wallet-move';
import { walletExists } from '$lib/stores/settings.svelte';
import { base } from '$app/paths';
import { syncNetworkFromRuntimeConfig } from '$lib/stores/network.svelte';

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
		// Wallet home (ADR-0008 §12): a legacy origin forwards to the configured
		// home, or asks to move a wallet still stored here; the move pages run
		// without booting the node so its store is copied at rest.
		const route = homeRoute({
			origin: location.origin,
			home: loaded.wallet_home_origin,
			base,
			pathname: location.pathname,
			search: location.search,
			hash: location.hash,
			hasWallet: walletExists(),
			moved: readMovedTo() !== null,
			deferred: sessionStorage.getItem(MOVE_DEFER_KEY) === 'true'
		});
		if (route.kind === 'forward' || route.kind === 'move') {
			if (route.kind === 'move') sessionStorage.setItem(MOVE_NEXT_KEY, route.next);
			location.replace(route.url);
			return await new Promise<never>(() => {}); // navigating away: render and boot nothing
		}
		syncNetworkFromRuntimeConfig();
		if (route.kind === 'migrate' || route.kind === 'move-page') {
			return {};
		}
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
		// Other sites reach this wallet only through the popup at /connect
		// (ADR-0008): no iframe bridge is installed — the wallet is never framed
		// (frame-ancestors 'none') and Safari would partition its storage.
		// DEV diagnostic: expose the authoritative app client so it can be probed
		// from the page console (dynamic `import('/src/lib/extro')` resolves to a
		// SEPARATE module instance whose singleton defaults to mock — unusable for
		// inspecting the real bundled client). Remove before ship.
		if ((import.meta.env.DEV || config.deployment === 'development') && client) {
			(window as unknown as { __extro?: unknown }).__extro = client;
		}
		// STAGING live gates: read-only probes only (never the debug client above).
		installGateSurface(window, client, config, arkStatus);
		// 'cross-domain' needs explicit crossDomain options wired by the caller;
		// leave the facade's lazy mock default in place for it (pre-production).
	}
	return {};
};
