import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '/wallet' }));

import { loadProofKeys, proofKeyUrls } from './swap-runner';

describe('proving-key URLs', () => {
	it('prefixes the app base path', () => {
		expect(proofKeyUrls('/wallet')).toEqual({
			bearer: '/wallet/circuits-dev/pk_bearer_payload.bin',
			conditional: '/wallet/circuits-dev/pk_conditional_leg.bin'
		});
		expect(proofKeyUrls('').bearer).toBe('/circuits-dev/pk_bearer_payload.bin');
		expect(proofKeyUrls('/wallet/').conditional).toBe('/wallet/circuits-dev/pk_conditional_leg.bin');
	});

	it('rejects an SPA-fallback HTML response instead of handing it to the prover', async () => {
		const html = vi.fn(async (_url: string) =>
			new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
		);
		await expect(loadProofKeys(html as unknown as typeof fetch)).rejects.toThrow(/proving key missing/);
		expect(html.mock.calls[0][0]).toBe('/wallet/circuits-dev/pk_bearer_payload.bin');
	});

	it('loads binary keys from the base-prefixed URLs', async () => {
		const bin = vi.fn(async (_url: string) =>
			new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { 'content-type': 'application/octet-stream' }
			})
		);
		const keys = await loadProofKeys(bin as unknown as typeof fetch);
		expect(keys.bearerPk).toEqual(new Uint8Array([1, 2, 3]));
		expect(bin.mock.calls.map((c) => c[0])).toEqual([
			'/wallet/circuits-dev/pk_bearer_payload.bin',
			'/wallet/circuits-dev/pk_conditional_leg.bin'
		]);
	});
});
