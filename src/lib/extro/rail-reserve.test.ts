import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ cmds: [] as unknown[] }));
vi.mock('./index', () => ({
	getExtroClient: () => ({
		send: async (req: { op: { cmd: { op: string; amount: string; index: number } } }) => {
			sent.cmds.push(req.op.cmd);
			const c = req.op.cmd;
			return {
				kind: 'Ok',
				request_id: new Uint8Array(16),
				body: {
					kind: 'WebcashReserved',
					secret: `e${c.amount}:secret:${'ab'.repeat(32)}`,
					public_token: `e${c.amount}:public:${'cd'.repeat(32)}`,
					change: 'e0.009:secret:' + 'ef'.repeat(32),
					index: c.index,
					unspent: true,
					replaced: true
				}
			};
		}
	})
}));
vi.mock('$lib/stores/network.svelte', () => ({ getNetwork: () => 'mainnet' }));

import { webcashReserve } from './rail';

describe('webcashReserve', () => {
	it('sends one ReserveWebcash rail op and returns the reserved leg + change', async () => {
		const out = await webcashReserve({
			index: 2,
			amount: '0.001',
			inputs: ['e0.01:secret:' + '11'.repeat(32)],
			serverUrl: 'https://webcash.org'
		});
		expect(sent.cmds).toEqual([
			{
				op: 'ReserveWebcash',
				index: 2,
				amount: '0.001',
				inputs: ['e0.01:secret:' + '11'.repeat(32)],
				server_url: 'https://webcash.org'
			}
		]);
		expect(out.state).toBe('ok');
		if (out.state === 'ok') {
			expect(out.value.change).toMatch(/^e0\.009:secret:/);
			expect(out.value.unspent).toBe(true);
		}
	});

	it('refuses an out-of-gap index without dispatching', async () => {
		sent.cmds.length = 0;
		const out = await webcashReserve({ index: 64, amount: '1', inputs: [], serverUrl: 'x' });
		expect(out.state).toBe('error');
		expect(sent.cmds).toHaveLength(0);
	});
});
