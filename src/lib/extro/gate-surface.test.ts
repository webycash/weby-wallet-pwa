import { describe, expect, it } from 'vitest';

import { ExtroClient, type ExtroAdapter } from '@extro/node';
import type { ExtroCommand, ExtroResponse } from '@extro/node';
import type { ArkStatus } from '$lib/ark/ark-status.svelte';
import type { ExtroRuntimeConfig } from '$lib/extro/release-config';
import { GATE_SURFACE_GLOBAL, installGateSurface } from './gate-surface';

// Public placeholder trust values only.
const base: ExtroRuntimeConfig = {
	schema_version: 2,
	deployment: 'staging',
	db_name: 'gate-surface-test',
	adapter_mode: 'bundled',
	keyserver_url: 'https://key.example',
	keyserver_domain: 'key.example',
	keyserver_fingerprint_hex: '11'.repeat(20),
	keyserver_vk_hex: '12'.repeat(32),
	referee_url: 'https://referee.example',
	referee_vk_hex: '13'.repeat(32),
	webcash_server_url: 'https://webcash.example',
	voucher_server_url: 'https://voucher.example',
	rgb_server_url: 'https://rgb.example',
	rgb_collectible_server_url: 'https://rgb21.example',
	ark_enabled: false,
	ark_network: 'bitcoin',
	ark_asp_url: '',
	ark_signer_pk_hex: '',
	ark_info_digest_hex: '',
	ark_checkpoint_tapscript_hex: '',
	ark_unilateral_exit_delay: 0,
	zkp_profile: 'development-only',
	zkp_bearer_vk_sha256: '18'.repeat(32),
	zkp_conditional_vk_sha256: '19'.repeat(32),
	ice_servers: ['stun:stun.example:3478'],
	turn_servers: [],
	wallet_home_origin: 'https://wallet.test',
	connected_apps: [],
	grant_ttl_secs: 3600
} as ExtroRuntimeConfig;

class ProbeAdapter implements ExtroAdapter {
	readonly mode = 'bundled' as const;
	readonly operations: string[] = [];
	constructor(private readonly fingerprint = base.keyserver_fingerprint_hex) {}
	async boot(): Promise<void> {}
	async dispatch(command: ExtroCommand): Promise<ExtroResponse> {
		const cmd = command.op.cmd;
		this.operations.push(`${command.op.kind}.${cmd.op}`);
		const ok = (body: any): ExtroResponse => ({ kind: 'Ok', request_id: command.request_id, body });
		if (cmd.op === 'Pin') return ok({ kind: 'KeyserverPinned' });
		if (cmd.op === 'Discover') return ok({ kind: 'Discovered', fingerprint_hex: this.fingerprint, verified: true });
		throw new Error(`unexpected ${cmd.op}`);
	}
}

const status = (): ArkStatus => ({
	ok: true,
	reason: null,
	receivedDigest: null,
	expectedDigest: 'a9'.repeat(32),
	attestation: null
});

describe('staging read-only gate surface', () => {
	it.each(['development', 'production'] as const)('is not installed on %s', (deployment) => {
		const target = {};
		const surface = installGateSurface(target, new ExtroClient(new ProbeAdapter()), { ...base, deployment }, status());
		expect(surface).toBeNull();
		expect(Object.hasOwn(target, GATE_SURFACE_GLOBAL)).toBe(false);
	});

	it('is not installed without a booted client', () => {
		expect(installGateSurface({}, null, base, status())).toBeNull();
	});

	it('exposes only the read-only probes, frozen and non-writable', () => {
		const target: Record<string, unknown> = {};
		const surface = installGateSurface(target, new ExtroClient(new ProbeAdapter()), base, status())!;
		expect(target[GATE_SURFACE_GLOBAL]).toBe(surface);
		expect(Object.keys(surface).sort()).toEqual(['ark', 'deployment', 'probeKeyserver']);
		expect(Object.isFrozen(surface)).toBe(true);
		expect(() => {
			target[GATE_SURFACE_GLOBAL] = {};
		}).toThrow();
	});

	it('reports the live Ark status as a detached snapshot', () => {
		const live = status();
		const surface = installGateSurface({}, new ExtroClient(new ProbeAdapter()), base, live)!;
		live.ok = false;
		live.reason = 'mismatch';
		const snap = surface.ark();
		expect(snap.ok).toBe(false);
		expect(snap.reason).toBe('mismatch');
		snap.ok = true;
		expect(live.ok).toBe(false);
	});

	it('probes the configured keyserver with Pin then Discover only', async () => {
		const adapter = new ProbeAdapter();
		const surface = installGateSurface({}, new ExtroClient(adapter), base, status())!;
		await expect(surface.probeKeyserver()).resolves.toEqual({
			verified: true,
			fingerprint_hex: base.keyserver_fingerprint_hex,
			matches_pin: true
		});
		expect(adapter.operations).toEqual(['Keyserver.Pin', 'Keyserver.Discover']);
	});

	it('reports a fingerprint that does not match the pin', async () => {
		const surface = installGateSurface({}, new ExtroClient(new ProbeAdapter('aa'.repeat(20))), base, status())!;
		expect((await surface.probeKeyserver()).matches_pin).toBe(false);
	});
});
