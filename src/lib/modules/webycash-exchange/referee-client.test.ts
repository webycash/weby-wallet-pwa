import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExtroCommand, ExtroResponse } from '@extro/node';
import { bootArkNode } from '$lib/ark/ark-node.testkit';

import { HttpRefereeClient } from './referee-client';

// The client is extro-node's (`Op::Exchange Referee`); the node's fetch is the
// global one, stubbed here.
const PIN = 'a1'.repeat(32);
let send: (c: ExtroCommand) => Promise<ExtroResponse>;

describe('HttpRefereeClient prepare boundary', () => {
	beforeAll(async () => {
		send = (await bootArkNode()).send;
	});
	afterEach(() => vi.unstubAllGlobals());

	it('posts exact octet-stream bytes and returns the signed binary response', async () => {
		const request = new Uint8Array([1, 2, 3, 4]);
		const signed = new Uint8Array([9, 8, 7]);
		const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const req = new Request(input, init);
			expect(req.url).toBe('https://referee.example/v1/swap/prepare');
			expect(req.method).toBe('POST');
			expect(req.headers.get('content-type')).toBe('application/octet-stream');
			expect(new Uint8Array(await req.arrayBuffer())).toEqual(request);
			return new Response(signed, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
		});
		vi.stubGlobal('fetch', fetchFn);
		const client = new HttpRefereeClient({ baseUrl: 'https://referee.example/', pinnedPubkeyHex: PIN, send });

		await expect(client.prepare(request)).resolves.toEqual(signed);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('fails closed with the referee error body', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('policy mismatch', { status: 422 })));
		const client = new HttpRefereeClient({ baseUrl: 'https://referee.example', pinnedPubkeyHex: PIN, send });

		await expect(client.prepare(new Uint8Array([1]))).rejects.toThrow(
			/referee \/v1\/swap\/prepare 422: policy mismatch/
		);
	});

	it('refuses to call a referee without a valid pinned key', async () => {
		const fetchFn = vi.fn();
		vi.stubGlobal('fetch', fetchFn);
		const client = new HttpRefereeClient({ baseUrl: 'https://referee.example', pinnedPubkeyHex: '', send });

		await expect(client.health()).rejects.toThrow(/pinned key must be 32-byte lower-case hex/);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('acks and audits in the referee shapes', async () => {
		const sig = 'cd'.repeat(64);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const req = new Request(input, init);
				if (req.url.endsWith('/ack')) {
					expect(await req.json()).toEqual({ swap_id: 's1', outcome: 'rotated', signature_hex: sig });
					return Response.json({ swap_id: 's1', verdict: 'Accepted' });
				}
				return Response.json([
					{ swap_id: 's1', phase: 'Prepared', ts_unix: 7, prior_tip: '', phase_payload: { a: 1 } }
				]);
			})
		);
		const client = new HttpRefereeClient({ baseUrl: 'https://referee.example', pinnedPubkeyHex: PIN, send });

		await expect(client.ack({ swap_id: 's1', outcome: 'rotated', signature_hex: sig })).resolves.toEqual({
			swap_id: 's1',
			verdict: 'Accepted'
		});
		await expect(client.audit('s1')).resolves.toEqual([
			{ swap_id: 's1', phase: 'Prepared', ts_unix: 7, prior_tip: '', phase_payload: '{"a":1}', signature: '' }
		]);
	});
});
