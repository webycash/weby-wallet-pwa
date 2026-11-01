import { describe, expect, it, vi } from 'vitest';
import { freshConfigFetcher } from './release-config';

describe('freshConfigFetcher', () => {
	it('versions the config URL and bypasses the HTTP cache', async () => {
		const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
		await freshConfigFetcher(inner as unknown as typeof fetch, 'v 1')('/wallet/runtime-config.json', {
			credentials: 'same-origin'
		});
		expect(inner).toHaveBeenCalledWith('/wallet/runtime-config.json?build=v%201', {
			credentials: 'same-origin',
			cache: 'no-store'
		});
	});

	it('appends to an existing query', async () => {
		const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
		await freshConfigFetcher(inner as unknown as typeof fetch, 'b')('/runtime-config.json?x=1');
		expect(inner.mock.calls[0][0]).toBe('/runtime-config.json?x=1&build=b');
	});
});
