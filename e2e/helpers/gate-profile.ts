/**
 * Live-gate deployment profiles.
 *
 * A live gate must prove it ran against the deployment it claims. Each profile
 * pins the network-defining fields of the served `runtime-config.json`
 * exactly; the gate fails on any mismatch rather than adapting to whatever the
 * host serves. Select with `E2E_GATE_PROFILE` (default `dev`).
 *
 * The values mirror `wrangler.dev.toml` / `wrangler.staging.toml` [vars] on
 * purpose: they are the independent expectation, not a copy read at runtime.
 */

export type GateProfileName = 'dev' | 'staging-mainnet';

export interface GateProfile {
	name: GateProfileName;
	/** Default base URL; `undefined` means E2E_BASE_URL is mandatory. */
	defaultBaseUrl?: string;
	expected: {
		deployment: 'development' | 'staging';
		ark_enabled: boolean;
		ark_network: 'signet' | 'bitcoin';
		ark_asp_url: string;
		webcash_server_url: string;
	};
}

export const GATE_PROFILES: Readonly<Record<GateProfileName, GateProfile>> = {
	dev: {
		name: 'dev',
		defaultBaseUrl: 'https://dev.weby.cash/wallet',
		expected: {
			deployment: 'development',
			ark_enabled: true,
			ark_network: 'signet',
			ark_asp_url: 'https://signet.arkade.sh',
			webcash_server_url: 'https://dev.weby.cash/api/webcash'
		}
	},
	'staging-mainnet': {
		name: 'staging-mainnet',
		// workers.dev host is account-specific; never guess it.
		defaultBaseUrl: undefined,
		expected: {
			deployment: 'staging',
			ark_enabled: true,
			ark_network: 'bitcoin',
			ark_asp_url: 'https://arkade.computer',
			webcash_server_url: 'https://webcash.org'
		}
	}
};

export function selectGateProfile(env: Readonly<Record<string, string | undefined>> = process.env): {
	profile: GateProfile;
	baseUrl: string;
} {
	const name = env.E2E_GATE_PROFILE ?? 'dev';
	if (!Object.hasOwn(GATE_PROFILES, name)) {
		throw new Error(
			`unknown E2E_GATE_PROFILE '${name}' (expected one of: ${Object.keys(GATE_PROFILES).join(', ')})`
		);
	}
	const profile = GATE_PROFILES[name as GateProfileName];
	const baseUrl = env.E2E_BASE_URL ?? profile.defaultBaseUrl;
	if (!baseUrl) throw new Error(`E2E_GATE_PROFILE=${name} requires E2E_BASE_URL`);
	return { profile, baseUrl: baseUrl.replace(/\/$/, '') };
}

/** Every network-defining field that differs from the profile, exactly compared. */
export function profileMismatches(profile: GateProfile, served: Record<string, unknown>): string[] {
	const mismatches: string[] = [];
	for (const [field, expected] of Object.entries(profile.expected)) {
		const actual = served[field];
		if (actual !== expected) {
			mismatches.push(`${field}: expected ${JSON.stringify(expected)}, served ${JSON.stringify(actual)}`);
		}
	}
	return mismatches;
}
