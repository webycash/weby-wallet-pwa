import { describe, expect, it } from 'vitest';

import { zkpArtifacts } from './zkp-artifacts';

describe('zkp-artifacts manifest', () => {
	it('pins the development ceremony keys under circuits-dev', () => {
		const dev = zkpArtifacts('development-only');
		expect(dev.dir).toBe('circuits-dev');
		expect(dev.bearerSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(dev.conditionalSha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it('refuses profiles without published keys', () => {
		expect(() => zkpArtifacts('mpc-unknown')).toThrow(/no pinned proving keys/);
		expect(() => zkpArtifacts('__proto__')).toThrow(/no pinned proving keys/);
	});
});
