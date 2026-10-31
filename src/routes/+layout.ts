import { browser } from '$app/environment';
import { attestConfiguredArkOperator } from '$lib/ark/operator';
import { arkStatus } from '$lib/ark/ark-status.svelte';
import { configureExtro } from '$lib/extro';
import { configuredAdapterMode } from '$lib/extro/config';
import { disableArkForSession, loadRuntimeConfig } from '$lib/extro/release-config';
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
		// every network, identity and safety-policy pin in this immutable release.
		// Fail-soft: a mismatch disables Ark for this session (visible warning)
		// instead of taking the whole wallet down; Webcash/vouchers keep working.
		let config = loaded;
		if (loaded.ark_enabled) {
			try {
				const att = await attestConfiguredArkOperator(loaded);
				if (att) {
					arkStatus.ok = true;
					arkStatus.attestation = {
						url: att.url,
						network: att.network,
						signer_pk_hex: att.signer_pk_hex,
						info_digest: att.info_digest,
						unilateral_exit_delay: String(att.unilateral_exit_delay)
					};
				}
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				const received = /info digest mismatch: expected [0-9a-f]{64}, received ([0-9a-f]{64})/i.exec(reason)?.[1] ?? null;
				arkStatus.ok = false;
				arkStatus.reason = reason;
				arkStatus.receivedDigest = received;
				arkStatus.expectedDigest = loaded.ark_info_digest_hex;
				console.error('[ark] operator attestation failed; Ark disabled for this session', {
					reason,
					expected_digest: loaded.ark_info_digest_hex,
					received_digest: received
				});
				config = disableArkForSession();
			}
		} else {
			arkStatus.ok = false;
			arkStatus.reason = 'Ark is disabled in runtime configuration';
		}
		const mode = configuredAdapterMode();
		let client: ReturnType<typeof configureExtro> | null = null;
		if (mode === 'bundled') {
			client = configureExtro({
				mode: 'bundled',
				bundled: { bootConfig: config }
			});
		}
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
		// 'cross-domain' needs explicit crossDomain options wired by the caller;
		// leave the facade's lazy mock default in place for it (pre-production).
	}
	return {};
};
