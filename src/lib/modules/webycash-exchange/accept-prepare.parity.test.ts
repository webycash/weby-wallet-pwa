// Parity gate (ADR-0007, audit H3): prepare-terms assembly and the provider's
// check of seller-built terms live in extro-node (`Op::Exchange PrepareTerms`
// / `ProviderCheckTerms`). Every case of `@extro/node/vectors/prepare_terms.json`
// and `provider_check_terms.json` (oracle: this wallet's pre-switch TS) must
// match the wallet's `buildArkPrepareTermsFromProvider` / `assertProviderOwnedTerms`.
// The live ops are pinned against the same vectors in extro-node's own suites.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArkPrepareTerms, ExtroCommand, ExtroResponse, WireProviderMaterial } from '@extro/node';
import { bootArkNode } from '$lib/ark/ark-node.testkit';

let send: (c: ExtroCommand) => Promise<ExtroResponse>;
let cfg: Record<string, unknown> = {};
vi.mock('$lib/extro', async (orig) => ({
	...(await orig<object>()),
	getExtroClient: () => ({ send: (c: ExtroCommand) => send(c) })
}));
vi.mock('$lib/extro/release-config', async (orig) => ({
	...(await orig<object>()),
	getRuntimeConfig: () => cfg
}));

import { buildArkPrepareTermsFromProvider } from './accept-prepare';
import { assertProviderOwnedTerms } from './ark-swap-protocol';

const require = createRequire(import.meta.url);
type Raw = Record<string, unknown> & { provider: Record<string, string> };
type Exp = { error?: string; terms?: unknown; ok?: true };
const prep = JSON.parse(readFileSync(require.resolve('@extro/node/vectors/prepare_terms.json'), 'utf8')) as {
	cases: { name: string; input: Raw; expected: Exp }[];
};
const check = JSON.parse(readFileSync(require.resolve('@extro/node/vectors/provider_check_terms.json'), 'utf8')) as {
	cases: { name: string; terms_input: Raw; facts: Record<string, string> & { offer: Record<string, string>; now_unix: number }; expected: Exp }[];
};

const hb = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const plain = (x: unknown): unknown =>
	x instanceof Uint8Array
		? Array.from(x, (b) => b.toString(16).padStart(2, '0')).join('')
		: typeof x === 'bigint'
			? x.toString()
			: x && typeof x === 'object'
				? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, plain(y)]))
				: x;
const offer = (p: Record<string, string>): WireProviderMaterial =>
	({ ...p, order_id: hb(p.order_id), provider_fp: hb(p.provider_fp), provider_pgp_pubkey: hb(p.provider_pgp_pubkey) }) as never;
const cfgOf = (i: Record<string, unknown>) => ({
	ark_enabled: true,
	ark_network: i.ark_network,
	ark_signer_pk_hex: i.ark_operator_signer_pk,
	ark_info_digest_hex: i.ark_operator_info_digest,
	ark_unilateral_exit_delay: Number(i.ark_unilateral_exit_delay)
});
const buildInput = (i: Raw) => ({
	orderId16: hb(i.order_id as string),
	signedOrderCommitmentSha256: hb(i.signed_order_commitment_sha256 as string),
	fillAmountRaw: BigInt(i.fill_amount_raw as string),
	provider: offer(i.provider),
	allowOffer: i.allow_offer as boolean,
	bearerSellerFpHex: i.bearer_seller_fp_hex as string,
	bearerSellerPgpPubkeyHex: i.bearer_seller_pgp_pubkey_hex as string,
	bearerSellerCancelPubkeyHex: i.bearer_seller_cancel_pubkey_hex as string,
	providerArkDestination: i.provider_ark_destination as string,
	bearerSellerArkDestination: i.bearer_seller_ark_destination as string,
	arkAmountSats: BigInt(i.ark_amount_sats as string),
	idempotencyKey: hb(i.idempotency_key as string),
	nonce: hb(i.nonce as string),
	expiresAtUnix: i.expires_at_unix as number
});
const outcome = async (f: () => unknown): Promise<{ ok: unknown } | { error: string }> => {
	try {
		return { ok: await f() };
	} catch (e) {
		return { error: (e as Error).message };
	}
};

beforeAll(async () => {
	send = (await bootArkNode()).send as never;
});
afterEach(() => vi.restoreAllMocks());

describe('prepare terms: extro-node vector = wallet', () => {
	it('buildArkPrepareTermsFromProvider matches every prepare_terms case', async () => {
		expect(prep.cases.length).toBeGreaterThanOrEqual(18);
		for (const c of prep.cases) {
			cfg = cfgOf(c.input);
			const got = await outcome(() => buildArkPrepareTermsFromProvider(buildInput(c.input)));
			if (c.expected.error) {
				expect('error' in got && got.error.endsWith(c.expected.error), `${c.name}: ${JSON.stringify(got)}`).toBe(true);
			} else {
				if (!('ok' in got)) throw new Error(`${c.name}: ${got.error}`);
				expect(plain(got.ok), c.name).toEqual(c.expected.terms);
			}
		}
	});

	it('assertProviderOwnedTerms matches every provider_check_terms case', async () => {
		expect(check.cases.length).toBeGreaterThanOrEqual(23);
		for (const c of check.cases) {
			cfg = cfgOf(c.terms_input);
			const terms = (await buildArkPrepareTermsFromProvider(buildInput(c.terms_input))) as ArkPrepareTerms;
			const f = c.facts;
			cfg = cfgOf(f);
			vi.spyOn(Date, 'now').mockReturnValue(f.now_unix * 1000);
			const got = await outcome(() =>
				assertProviderOwnedTerms({
					terms,
					offer: offer(f.offer),
					selfFpHex: f.self_fp_hex,
					arkDestination: f.ark_destination,
					orderId16: hb(f.order_id),
					counterpartyFpHex: f.counterparty_fp_hex,
					arkAmountSats: BigInt(f.ark_amount_sats)
				})
			);
			vi.restoreAllMocks();
			if (c.expected.error) {
				expect('error' in got && got.error.endsWith(c.expected.error), `${c.name}: ${JSON.stringify(got)}`).toBe(true);
			} else {
				expect('ok' in got, `${c.name}: ${JSON.stringify(got)}`).toBe(true);
			}
		}
	});

	it('the ark_enabled gate stays in the wallet', async () => {
		cfg = { ...cfgOf(prep.cases[0].input), ark_enabled: false };
		await expect(outcome(() => buildArkPrepareTermsFromProvider(buildInput(prep.cases[0].input)))).resolves.toEqual({
			error: 'PREPARE_REQUIRES_ARK: ark_enabled=false'
		});
	});
});
