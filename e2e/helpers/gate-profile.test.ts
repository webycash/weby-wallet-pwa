import { describe, expect, it } from 'vitest';
import { GATE_PROFILES, profileMismatches, selectGateProfile } from './gate-profile';

const devConfig = {
	deployment: 'development',
	ark_enabled: true,
	ark_network: 'signet',
	ark_asp_url: 'https://signet.arkade.sh',
	webcash_server_url: 'https://dev.weby.cash/api/webcash'
};
const stagingConfig = {
	deployment: 'staging',
	ark_enabled: true,
	ark_network: 'bitcoin',
	ark_asp_url: 'https://arkade.computer',
	webcash_server_url: 'https://webcash.org'
};

describe('live gate profiles', () => {
	it('defaults to dev on the dev deployment', () => {
		const selected = selectGateProfile({});
		expect(selected.profile.name).toBe('dev');
		expect(selected.baseUrl).toBe('https://dev.weby.cash/wallet');
	});

	it('strips a trailing slash from an explicit base URL', () => {
		expect(selectGateProfile({ E2E_BASE_URL: 'https://x.test/wallet/' }).baseUrl).toBe(
			'https://x.test/wallet'
		);
	});

	it('refuses an unknown profile instead of falling back', () => {
		expect(() => selectGateProfile({ E2E_GATE_PROFILE: 'prod' })).toThrow(/unknown E2E_GATE_PROFILE/);
	});

	it('requires an explicit base URL for staging-mainnet (no guessed host)', () => {
		expect(() => selectGateProfile({ E2E_GATE_PROFILE: 'staging-mainnet' })).toThrow(/E2E_BASE_URL/);
		expect(
			selectGateProfile({ E2E_GATE_PROFILE: 'staging-mainnet', E2E_BASE_URL: 'https://s.test/wallet' })
				.profile.name
		).toBe('staging-mainnet');
	});

	it('accepts each served config only under its own profile', () => {
		expect(profileMismatches(GATE_PROFILES.dev, devConfig)).toEqual([]);
		expect(profileMismatches(GATE_PROFILES['staging-mainnet'], stagingConfig)).toEqual([]);
		expect(profileMismatches(GATE_PROFILES.dev, stagingConfig)).toHaveLength(4);
		expect(profileMismatches(GATE_PROFILES['staging-mainnet'], devConfig)).toHaveLength(4);
	});

	it('compares exactly (no substring or truthiness matches)', () => {
		expect(
			profileMismatches(GATE_PROFILES.dev, {
				...devConfig,
				webcash_server_url: 'https://dev.weby.cash/api/webcash/evil',
				ark_enabled: 'true'
			})
		).toEqual([
			'ark_enabled: expected true, served "true"',
			'webcash_server_url: expected "https://dev.weby.cash/api/webcash", served "https://dev.weby.cash/api/webcash/evil"'
		]);
	});
});
