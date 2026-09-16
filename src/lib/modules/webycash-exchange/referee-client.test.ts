import { describe, expect, it, vi } from 'vitest';

import { HttpRefereeClient } from './referee-client';

describe('HttpRefereeClient prepare boundary', () => {
	it('posts exact octet-stream bytes and returns the signed binary response', async () => {
		const request = new Uint8Array([1, 2, 3, 4]);
		const signed = new Uint8Array([9, 8, 7]);
		const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.method).toBe('POST');
			expect(init?.headers).toEqual({ 'Content-Type': 'application/octet-stream' });
			expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(request);
			return new Response(signed, {
				status: 200,
				headers: { 'Content-Type': 'application/octet-stream' }
			});
		}) as unknown as typeof fetch;
		const client = new HttpRefereeClient({
			baseUrl: 'https://referee.example/',
			fetchFn
		});

		await expect(client.prepare(request)).resolves.toEqual(signed);
		expect(fetchFn).toHaveBeenCalledWith(
			'https://referee.example/v1/swap/prepare',
			expect.any(Object)
		);
	});

	it('fails closed with the referee error body', async () => {
		const fetchFn = vi.fn(async () => new Response('policy mismatch', { status: 422 })) as unknown as
			typeof fetch;
		const client = new HttpRefereeClient({ baseUrl: 'https://referee.example', fetchFn });

		await expect(client.prepare(new Uint8Array([1]))).rejects.toThrow(
			/referee \/v1\/swap\/prepare 422: policy mismatch/
		);
	});
});
