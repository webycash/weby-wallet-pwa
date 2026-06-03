import { describe, it, expect, beforeEach } from 'vitest';
import { ExtroClient } from '$lib/extro/client';
import { MockExtroAdapter } from '$lib/extro/mock-node';
import {
	PushHookRouter,
	dedupeKeyFor,
	bytesToB64,
	type PushMessage,
	type SignedAck
} from './push-hooks';

const msg = (over: Partial<PushMessage> = {}): PushMessage => ({
	swapId: 'ab'.repeat(16),
	kind: 'insert',
	senderVk: 'cc'.repeat(32),
	signedPayload: bytesToB64(new Uint8Array([1, 2, 3, 4])),
	ciphertextHash: 'dd'.repeat(32),
	recipientFingerprint: 'ee'.repeat(20),
	...over
});

const makeRouter = (opts: {
	unlocked: boolean;
	forceOutcome?: 'Processed' | 'Queued' | 'Duplicate';
	onAck?: (a: SignedAck) => void;
}) => {
	const adapter = new MockExtroAdapter(
		opts.forceOutcome ? { forceHookOutcome: opts.forceOutcome } : {}
	);
	const client = new ExtroClient(adapter);
	const router = new PushHookRouter({
		client,
		isUnlocked: () => opts.unlocked,
		onAck: opts.onAck,
		now: () => 1000
	});
	return { router, adapter, client };
};

describe('push-hooks: dedupe by (swap_id, kind, payload_hash)', () => {
	it('processes the first message and dedupes an identical redelivery', async () => {
		const { router, adapter } = makeRouter({ unlocked: true });
		const first = await router.route(msg());
		expect(first).toMatchObject({ status: 'processed' });
		const dup = await router.route(msg());
		expect(dup).toEqual({ status: 'duplicate' });
		// Only ONE dispatch reached the node.
		expect(adapter.calls).toBe(1);
	});

	it('does NOT dedupe when payload_hash differs for same (swap_id, kind)', async () => {
		const { router, adapter } = makeRouter({ unlocked: true });
		await router.route(msg({ signedPayload: bytesToB64(new Uint8Array([1, 1, 1])) }));
		// Same swap + kind, DIFFERENT payload (e.g. a rotated secret) → new key.
		const second = await router.route(
			msg({ signedPayload: bytesToB64(new Uint8Array([9, 9, 9])) })
		);
		expect(second).toMatchObject({ status: 'processed' });
		expect(adapter.calls).toBe(2);
	});

	it('does NOT dedupe across different kinds for the same swap+payload', async () => {
		const { router } = makeRouter({ unlocked: true });
		await router.route(msg({ kind: 'insert' }));
		const other = await router.route(msg({ kind: 'invalidate' }));
		expect(other).toMatchObject({ status: 'processed' });
	});

	it('dedupeKey encodes the exact tuple', async () => {
		const k1 = await dedupeKeyFor(msg());
		const k2 = await dedupeKeyFor(msg({ kind: 'invalidate' }));
		expect(k1.startsWith('ab'.repeat(16) + ':insert:')).toBe(true);
		expect(k2.startsWith('ab'.repeat(16) + ':invalidate:')).toBe(true);
		expect(k1).not.toBe(k2);
	});
});

describe('push-hooks: locked wallet queues safe metadata only', () => {
	it('queues while locked and never dispatches', async () => {
		const { router, adapter } = makeRouter({ unlocked: false });
		const r = await router.route(msg());
		expect(r).toEqual({ status: 'queued', reason: 'wallet-locked' });
		expect(adapter.calls).toBe(0);
		expect(router.queuedCount).toBe(1);
	});

	it('the queued record contains ONLY safe metadata — no plaintext secret', async () => {
		const { router } = makeRouter({ unlocked: false });
		await router.route(msg());
		const [queued] = router.queued;
		const record = queued.message;
		// Present: safe commitments.
		expect(record.swapId).toBeDefined();
		expect(record.signedPayload).toBeDefined();
		expect(record.ciphertextHash).toBeDefined();
		// Absent: any plaintext-secret-bearing field. The type has none; assert
		// the serialized record carries no such key and no 64-hex "secret".
		const json = JSON.stringify(queued);
		for (const forbidden of ['secret', 'plaintext', 'privateKey', 'mnemonic', 'seed']) {
			expect(json.toLowerCase()).not.toContain(forbidden);
		}
	});

	it('does not double-queue the same message while locked', async () => {
		const { router } = makeRouter({ unlocked: false });
		await router.route(msg());
		await router.route(msg());
		expect(router.queuedCount).toBe(1);
	});

	it('replays queued hooks after unlock, then drains the queue', async () => {
		let unlocked = false;
		const adapter = new MockExtroAdapter();
		const client = new ExtroClient(adapter);
		const router = new PushHookRouter({
			client,
			isUnlocked: () => unlocked,
			now: () => 1000
		});
		await router.route(msg({ signedPayload: bytesToB64(new Uint8Array([1])) }));
		await router.route(msg({ signedPayload: bytesToB64(new Uint8Array([2])) }));
		expect(router.queuedCount).toBe(2);
		expect(adapter.calls).toBe(0);

		unlocked = true;
		const results = await router.replayQueued();
		expect(results.every((r) => r.status === 'processed')).toBe(true);
		expect(adapter.calls).toBe(2);
		expect(router.queuedCount).toBe(0);
	});

	it('replay is a no-op while still locked', async () => {
		const { router } = makeRouter({ unlocked: false });
		await router.route(msg());
		const results = await router.replayQueued();
		expect(results).toEqual([]);
		expect(router.queuedCount).toBe(1);
	});
});

describe('push-hooks: signed ack after processing', () => {
	it('emits a redaction-safe ack on a processed hook', async () => {
		const acks: SignedAck[] = [];
		const { router } = makeRouter({ unlocked: true, onAck: (a) => acks.push(a) });
		await router.route(msg());
		expect(acks.length).toBe(1);
		expect(acks[0]).toEqual({ swapId: 'ab'.repeat(16), kind: 'insert', outcome: 'Processed' });
		// Ack carries no secret.
		expect(JSON.stringify(acks[0]).toLowerCase()).not.toContain('secret');
	});

	it('does not ack a duplicate', async () => {
		const acks: SignedAck[] = [];
		const { router } = makeRouter({ unlocked: true, onAck: (a) => acks.push(a) });
		await router.route(msg());
		await router.route(msg());
		expect(acks.length).toBe(1);
	});

	it('routes every hook kind to a push dispatch', async () => {
		const { router, adapter } = makeRouter({ unlocked: true });
		for (const kind of ['insert', 'invalidate', 'release-settle', 'release-refund', 'fail-to-deliver'] as const) {
			await router.route(msg({ kind, signedPayload: bytesToB64(new Uint8Array([kind.length])) }));
		}
		expect(adapter.calls).toBe(5);
	});
});
