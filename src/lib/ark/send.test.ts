import { describe, expect, it } from 'vitest';
import { validateArkSend } from './send';

const own = 'ark1' + 'q'.repeat(100);
const dest = 'ark1' + 'p'.repeat(100);
const base = { address: dest, amount: 560, balanceSats: 560, ownAddress: own, hrp: 'ark' };

describe('validateArkSend', () => {
	it('accepts a full-balance send to another mainnet ark address', () => {
		expect(validateArkSend(base)).toEqual({ ok: true, amount: 560 });
	});
	it('rejects testnet addresses on mainnet and vice versa', () => {
		expect(validateArkSend({ ...base, address: 'tark1' + 'p'.repeat(100) }).ok).toBe(false);
		expect(validateArkSend({ ...base, hrp: 'tark' }).ok).toBe(false);
	});
	it('rejects self, dust, fractional and over-balance amounts', () => {
		expect(validateArkSend({ ...base, address: own }).ok).toBe(false);
		expect(validateArkSend({ ...base, amount: 329 }).ok).toBe(false);
		expect(validateArkSend({ ...base, amount: 400.5 }).ok).toBe(false);
		expect(validateArkSend({ ...base, amount: 561 }).ok).toBe(false);
	});
	it('rejects on-chain / garbage destinations', () => {
		expect(validateArkSend({ ...base, address: 'bc1qxyz' }).ok).toBe(false);
		expect(validateArkSend({ ...base, address: '' }).ok).toBe(false);
	});
});
