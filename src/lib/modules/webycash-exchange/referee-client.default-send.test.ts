import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExtroClient, type ExtroAdapter, type ExtroCommand, type ExtroResponse } from '@extro/node';
import { bootArkNode } from '$lib/ark/ark-node.testkit';

// Production wiring: no `send` option, so the client must fall back to the
// app's ExtroClient. ExtroClient.send is a prototype method that uses `this`
// (its single-flight queue), so a detached `getExtroClient().send` throws
// "Cannot read properties of undefined (reading 'enqueue')" on the first
// referee call — the prod swap failure of 2026-11-03.
let app: ExtroClient;
vi.mock('$lib/extro', () => ({ getExtroClient: () => app }));

import { HttpRefereeClient } from './referee-client';

const PIN = 'a1'.repeat(32);

describe('HttpRefereeClient default send (app ExtroClient)', () => {
	beforeAll(async () => {
		const node = (await bootArkNode()).send as (c: ExtroCommand) => Promise<ExtroResponse>;
		const adapter: ExtroAdapter = { mode: 'bundled', boot: async () => {}, dispatch: (c) => node(c) };
		app = new ExtroClient(adapter);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('calls the referee through the real ExtroClient queue when no send is given', async () => {
		const signed = new Uint8Array([9, 8, 7]);
		const fetchFn = vi.fn(
			async () => new Response(signed, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
		);
		vi.stubGlobal('fetch', fetchFn);
		const client = new HttpRefereeClient({ baseUrl: 'https://referee.example', pinnedPubkeyHex: PIN });

		await expect(client.prepare(new Uint8Array([1, 2, 3]))).resolves.toEqual(signed);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
