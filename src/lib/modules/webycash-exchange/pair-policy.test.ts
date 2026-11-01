import { describe, it, expect } from 'vitest';
import {
	evaluatePair,
	isPairAllowed,
	pairRequiresReferee,
	type AssetClass
, pairReleaseAvailability } from './pair-policy';

describe('pair-policy: Webcash <-> Voucher is blocked (both orderings)', () => {
	it('rejects Webcash -> Voucher', () => {
		const v = evaluatePair('Webcash', 'Voucher');
		expect(v.allowed).toBe(false);
		expect(v.settlementModel).toBe('blocked');
		expect(v.reason).toBe('both-bearer-no-arbitrable-leg');
	});

	it('rejects Voucher -> Webcash (order-independent)', () => {
		const v = evaluatePair('Voucher', 'Webcash');
		expect(v.allowed).toBe(false);
		expect(v.reason).toBe('both-bearer-no-arbitrable-leg');
	});

	it('isPairAllowed agrees in both directions', () => {
		expect(isPairAllowed('Webcash', 'Voucher')).toBe(false);
		expect(isPairAllowed('Voucher', 'Webcash')).toBe(false);
	});
});

describe('pair-policy: same-bearer and Custom/two-bearer are blocked', () => {
	it('blocks Webcash <-> Webcash', () => {
		expect(evaluatePair('Webcash', 'Webcash').allowed).toBe(false);
	});
	it('blocks Voucher <-> Voucher', () => {
		expect(evaluatePair('Voucher', 'Voucher').allowed).toBe(false);
	});
	it('blocks Custom on either side', () => {
		expect(evaluatePair('Custom', 'BitcoinArk').allowed).toBe(false);
		expect(evaluatePair('BitcoinArk', 'Custom').allowed).toBe(false);
		expect(evaluatePair('Custom', 'Custom').reason).toBe('custom-asset-unsupported');
	});
});

describe('pair-policy: bearer <-> Bitcoin ARK requires referee, never atomic', () => {
	it('Webcash <-> ARK requires referee and is bounded-risk', () => {
		const v = evaluatePair('Webcash', 'BitcoinArk');
		expect(v.allowed).toBe(true);
		expect(v.requiresReferee).toBe(true);
		expect(v.bearerRaceRisk).toBe(true);
		expect(v.settlementModel).toBe('referee-mediated');
		// Never POSITIVELY claim atomicity for a bearer flow. The label may say
		// "non-atomic" / "not ... atomic"; it must never assert it IS atomic.
		const label = v.label.toLowerCase();
		expect(label).toContain('non-atomic');
		expect(/(?<!non-)(?<!not a cryptographically )atomic swap/.test(label)).toBe(false);
	});

	it('ARK <-> Voucher requires referee (order-independent)', () => {
		expect(pairRequiresReferee('BitcoinArk', 'Voucher')).toBe(true);
		expect(pairRequiresReferee('Voucher', 'BitcoinArk')).toBe(true);
	});
});

describe('pair-policy: RGB pairs', () => {
	// extro docs 27 row 14 + GAP C: bearer<->RGB settles RefereeZkp, referee
	// required; the RGB leg is the conditional one.
	it('RGB <-> Webcash is referee-mediated (RefereeZkp), bearer-race risk flagged', () => {
		for (const [a, b] of [['Rgb20', 'Webcash'], ['Webcash', 'Rgb20'], ['Voucher', 'Rgb21']] as const) {
			const v = evaluatePair(a, b);
			expect(v.allowed).toBe(true);
			expect(v.nodeSettlementModel).toBe('RefereeZkp');
			expect(v.settlementModel).toBe('referee-mediated');
			expect(v.requiresReferee).toBe(true);
			expect(v.requiresConditionalLeg).toBe(true);
			expect(v.bearerRaceRisk).toBe(true);
			expect(v.reason).toBe('bearer-vs-rgb-referee');
		}
	});

	it('RGB <-> ARK allowed without bearer-race risk', () => {
		const v = evaluatePair('Rgb21', 'BitcoinArk');
		expect(v.allowed).toBe(true);
		expect(v.bearerRaceRisk).toBe(false);
	});

	it('RGB <-> RGB allowed, atomic via RGB server, no referee', () => {
		const v = evaluatePair('Rgb20', 'Rgb21');
		expect(v.allowed).toBe(true);
		expect(v.settlementModel).toBe('rgb-atomic');
		expect(v.requiresReferee).toBe(false);
		expect(v.bearerRaceRisk).toBe(false);
	});
});

describe('pair-policy: deny by default', () => {
	// extro docs 24/27 have no ARK<->ARK row; doc 25 referee step 4: fail closed.
	it('ARK <-> ARK is not a supported exchange pair', () => {
		expect(evaluatePair('BitcoinArk', 'BitcoinArk').allowed).toBe(false);
		expect(evaluatePair('BitcoinArk', 'BitcoinArk').nodeSettlementModel).toBe('Forbidden');
	});

	it('every allowed verdict that touches a bearer leg requires referee', () => {
		const classes: AssetClass[] = ['Webcash', 'Voucher', 'BitcoinArk', 'Rgb20', 'Rgb21', 'Custom'];
		const bearer = new Set<AssetClass>(['Webcash', 'Voucher']);
		for (const a of classes) {
			for (const b of classes) {
				const v = evaluatePair(a, b);
				if (v.allowed && (bearer.has(a) || bearer.has(b))) {
					// A permitted pair with a bearer leg must be referee/contract
					// arbitrable on the other side AND never atomic.
					expect(v.requiresReferee).toBe(true);
					expect(v.settlementModel).not.toBe('rgb-atomic');
				}
			}
		}
	});
});


describe('RGB/Voucher release availability (webycash-server rails)', () => {
	it('makes Voucher↔BitcoinArk available when pair-policy allows', () => {
		const a = pairReleaseAvailability('Voucher', 'BitcoinArk');
		expect(a.available).toBe(true);
		expect(a.message).toMatch(/webycash-server/);
	});
	it('makes Webcash↔Rgb20 available when pair-policy allows', () => {
		const a = pairReleaseAvailability('Webcash', 'Rgb20');
		expect(a.available).toBe(true);
		expect(a.message).toMatch(/webycash-server/);
	});
});
