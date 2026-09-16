import { describe, it, expect } from 'vitest';
import { ExtroClient } from './client';
import { MockExtroAdapter, makeGate } from './mock-node';
import { newRequestId, type ExtroCommand } from './commands';

const cmd = (): ExtroCommand => ({
	request_id: newRequestId(),
	op: { kind: 'Wallet', cmd: { op: 'ListSummaries', slot: 0 } }
});

describe('F-PWA-1: facade serializes extro_node_send (single-flight)', () => {
	it('never runs two dispatches concurrently even when both are awaited together', async () => {
		// The mock yields and would record maxConcurrent > 1 if the facade let
		// two dispatches overlap. The gate widens the overlap window: the first
		// dispatch is held open while we fire the second.
		const gate = makeGate();
		const adapter = new MockExtroAdapter({ gate });
		const client = new ExtroClient(adapter);

		const p1 = client.send(cmd());
		const p2 = client.send(cmd());

		// Give the microtask queue several turns: if serialization were broken,
		// both dispatches would have entered and bumped maxConcurrent to 2 by now.
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(adapter.inFlight).toBeLessThanOrEqual(1);

		// Release the gate; both should now complete, in order.
		gate.release();
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1.kind).toBe('Ok');
		expect(r2.kind).toBe('Ok');

		// The high-water mark proves only one dispatch was ever in-flight.
		expect(adapter.maxConcurrent).toBe(1);
		expect(adapter.calls).toBe(2);
	});

	it('serializes a burst of overlapping sends (FIFO, max 1 in-flight)', async () => {
		const adapter = new MockExtroAdapter();
		const client = new ExtroClient(adapter);

		const sends = Array.from({ length: 8 }, () => client.send(cmd()));
		await Promise.all(sends);

		expect(adapter.maxConcurrent).toBe(1);
		expect(adapter.calls).toBe(8);
	});

	it('a rejected/failed send does not poison the queue', async () => {
		// Force the adapter to error on boot-less dispatch by NOT booting via the
		// adapter directly; instead simulate a transient failure by throwing from
		// a one-shot wrapper, then ensure the next send still runs.
		const adapter = new MockExtroAdapter();
		const client = new ExtroClient(adapter);

		// Monkey-patch dispatch to throw exactly once.
		const realDispatch = adapter.dispatch.bind(adapter);
		let threw = false;
		adapter.dispatch = async (c) => {
			if (!threw) {
				threw = true;
				adapter.dispatch = realDispatch;
				throw new Error('transient');
			}
			return realDispatch(c);
		};

		await expect(client.send(cmd())).rejects.toThrow('transient');
		// The chain must have advanced: this next send resolves normally.
		const r = await client.send(cmd());
		expect(r.kind).toBe('Ok');
		expect(adapter.maxConcurrent).toBe(1);
	});

	it('boot runs once even under concurrent sends', async () => {
		let boots = 0;
		const adapter = new MockExtroAdapter();
		const realBoot = adapter.boot.bind(adapter);
		adapter.boot = async () => {
			boots += 1;
			await Promise.resolve();
			return realBoot();
		};
		const client = new ExtroClient(adapter);
		await Promise.all([client.send(cmd()), client.send(cmd()), client.boot()]);
		expect(boots).toBe(1);
	});
});
