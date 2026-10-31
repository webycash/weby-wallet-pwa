import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$app/paths', () => ({ base: '/wallet' }));
vi.mock('$lib/extro/zkp-artifacts', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/extro/zkp-artifacts')>();
	// sha256 of [1,2,3] and [4,5,6]
	const sets: Record<string, import('$lib/extro/zkp-artifacts').ZkpArtifactSet> = {
		'test-profile': {
			dir: 'circuits-test',
			bearerSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
			conditionalSha256: '787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472'
		}
	};
	return {
		...real,
		zkpArtifacts: (profile: string) => {
			if (!sets[profile]) throw new Error(`no pinned proving keys for ZKP profile \`${profile}\``);
			return sets[profile];
		}
	};
});

import { loadProofKeys, proofKeyUrls, resetProofKeys } from './swap-runner';

const bin = (map: Record<string, number[]>) =>
	vi.fn(async (url: string) =>
		new Response(new Uint8Array(map[url] ?? []), {
			status: 200,
			headers: { 'content-type': 'application/octet-stream' }
		})
	);

beforeEach(() => resetProofKeys());

describe('proving-key URLs', () => {
	it('prefixes the app base path and the profile directory', () => {
		const set = { dir: 'circuits-dev', bearerSha256: '', conditionalSha256: '' };
		expect(proofKeyUrls('/wallet', set)).toEqual({
			bearer: '/wallet/circuits-dev/pk_bearer_payload.bin',
			conditional: '/wallet/circuits-dev/pk_conditional_leg.bin'
		});
		expect(proofKeyUrls('', set).bearer).toBe('/circuits-dev/pk_bearer_payload.bin');
		expect(proofKeyUrls('/wallet/', set).conditional).toBe('/wallet/circuits-dev/pk_conditional_leg.bin');
	});

	it('rejects an SPA-fallback HTML response instead of handing it to the prover', async () => {
		const html = vi.fn(async (_url: string) =>
			new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
		);
		await expect(loadProofKeys(html as unknown as typeof fetch, 'test-profile')).rejects.toThrow(
			/proving key missing/
		);
		expect(html.mock.calls[0][0]).toBe('/wallet/circuits-test/pk_bearer_payload.bin');
	});

	it('loads the pinned binary keys of the profile', async () => {
		const f = bin({
			'/wallet/circuits-test/pk_bearer_payload.bin': [1, 2, 3],
			'/wallet/circuits-test/pk_conditional_leg.bin': [4, 5, 6]
		});
		const keys = await loadProofKeys(f as unknown as typeof fetch, 'test-profile');
		expect(keys.bearerPk).toEqual(new Uint8Array([1, 2, 3]));
		expect(keys.conditionalPk).toEqual(new Uint8Array([4, 5, 6]));
	});

	it('refuses a key whose hash is not pinned for the profile', async () => {
		const f = bin({
			'/wallet/circuits-test/pk_bearer_payload.bin': [9],
			'/wallet/circuits-test/pk_conditional_leg.bin': [4, 5, 6]
		});
		await expect(loadProofKeys(f as unknown as typeof fetch, 'test-profile')).rejects.toThrow(
			/not the pinned artifact/
		);
	});

	it('refuses a profile with no published keys', async () => {
		const f = bin({});
		await expect(loadProofKeys(f as unknown as typeof fetch, 'mpc-unknown')).rejects.toThrow(
			/no pinned proving keys/
		);
		expect(f).not.toHaveBeenCalled();
	});
});

