import { describe, it, expect } from 'vitest';
import {
	isValidKeyserverPayload,
	toPushMessage,
	isExchangePushMessage,
	EXCHANGE_PUSH_MSG,
	type KeyserverPushPayload
} from './push-transport';

const valid: KeyserverPushPayload = {
	module: 'webycash-exchange',
	swap_id: 'ab'.repeat(16),
	kind: 'insert',
	sender_vk: 'cc'.repeat(32),
	signed_payload: 'AAEC',
	ciphertext_hash: 'dd'.repeat(32)
};

describe('push-transport: payload validation', () => {
	it('accepts a well-formed exchange payload', () => {
		expect(isValidKeyserverPayload(valid)).toBe(true);
	});

	it('rejects wrong module', () => {
		expect(isValidKeyserverPayload({ ...valid, module: 'other' })).toBe(false);
	});

	it('rejects unknown kind', () => {
		expect(isValidKeyserverPayload({ ...valid, kind: 'wat' })).toBe(false);
	});

	it('rejects missing signed_payload', () => {
		const { signed_payload, ...rest } = valid;
		expect(isValidKeyserverPayload(rest)).toBe(false);
	});

	it('rejects non-objects', () => {
		expect(isValidKeyserverPayload(null)).toBe(false);
		expect(isValidKeyserverPayload('x')).toBe(false);
	});
});

describe('push-transport: safe mapping', () => {
	it('maps to a PushMessage carrying only safe metadata', () => {
		const m = toPushMessage(valid);
		expect(m.swapId).toBe(valid.swap_id);
		expect(m.signedPayload).toBe(valid.signed_payload);
		// No plaintext-secret field exists on the mapped shape.
		const json = JSON.stringify(m).toLowerCase();
		for (const forbidden of ['secret', 'plaintext', 'mnemonic', 'privatekey', 'seed']) {
			expect(json).not.toContain(forbidden);
		}
	});

	it('drops any extra (non-allowlisted) fields from the payload', () => {
		const dirty = { ...valid, secret: 'deadbeef', plaintext: 'leak' } as any;
		const m = toPushMessage(dirty);
		expect((m as any).secret).toBeUndefined();
		expect((m as any).plaintext).toBeUndefined();
	});
});

describe('push-transport: SW→app message guard', () => {
	it('recognises the exchange push message', () => {
		expect(isExchangePushMessage({ type: EXCHANGE_PUSH_MSG, message: toPushMessage(valid) })).toBe(true);
		expect(isExchangePushMessage({ type: 'other' })).toBe(false);
	});
});
