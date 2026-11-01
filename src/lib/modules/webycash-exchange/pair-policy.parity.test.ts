// Parity gate (ADR-0007): the wallet's pair policy is extrolib `PairPolicy`
// as served by extro-node. Every case of `@extro/node/vectors/pair_policy.json`
// (each citing its spec) must match (a) the live `Op::Exchange PairPolicy` and
// (b) the wallet's `evaluatePair`, and the UI labels must stay honest.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootArkNode } from '$lib/ark/ark-node.testkit';
import { pairPolicyNode, type ExtroSend } from './exchange-core';
import { evaluatePair, evaluatePairNode, type AssetClass } from './pair-policy';

const require = createRequire(import.meta.url);

interface Case {
	base: AssetClass;
	quote: AssetClass;
	prefer_conditional: boolean;
	expected: { allowed: boolean; settlement_model: string; requires_referee: boolean; requires_conditional_leg: boolean; forbidden: boolean };
	spec: string;
}
const cases: Case[] = JSON.parse(readFileSync(require.resolve('@extro/node/vectors/pair_policy.json'), 'utf8')).cases;

let send: ExtroSend;
beforeAll(async () => {
	send = (await bootArkNode()).send;
});

describe('pair policy: extro-node vector = live Op = wallet', () => {
	it('covers every ordered pair of the six families, both preferences', () => {
		expect(cases).toHaveLength(72);
		expect(cases.every((c) => c.spec.length > 0)).toBe(true);
	});

	it('the live Op::Exchange PairPolicy returns the vector for every case', async () => {
		for (const c of cases) {
			const node = await pairPolicyNode(send, c.base, c.quote, c.prefer_conditional);
			const { forbidden, ...expected } = c.expected;
			expect(forbidden).toBe(!expected.allowed);
			expect({ case: `${c.base}/${c.quote}/${c.prefer_conditional}`, ...node }).toEqual({
				case: `${c.base}/${c.quote}/${c.prefer_conditional}`,
				...expected
			});
		}
	});

	it('evaluatePair (table) and evaluatePairNode (live) agree for every case', async () => {
		for (const c of cases) {
			const table = evaluatePair(c.base, c.quote, c.prefer_conditional);
			const live = await evaluatePairNode(send, c.base, c.quote, c.prefer_conditional);
			expect(table).toEqual(live);
			expect(table.allowed).toBe(c.expected.allowed);
			expect(table.requiresReferee).toBe(c.expected.requires_referee);
			expect(table.nodeSettlementModel).toBe(c.expected.settlement_model);
			if (table.bearerRaceRisk) {
				expect(table.settlementModel).not.toBe('rgb-atomic');
				expect(table.label.toLowerCase()).toContain('non-atomic');
			}
		}
	});

	it('an unknown family is refused by the Op, never allowed', async () => {
		await expect(
			pairPolicyNode(send, 'Lightning' as unknown as AssetClass, 'Webcash')
		).rejects.toThrow();
	});
});
