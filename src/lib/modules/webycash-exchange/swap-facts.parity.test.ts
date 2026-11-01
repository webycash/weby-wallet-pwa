// Parity gate (ADR-0007, audit H3): the swap-initiate facts checks live in
// extro-node (`Op::Exchange SwapFacts`). Every case of
// `@extro/node/vectors/swap_facts.json` (oracle: this wallet's pre-switch
// swap-facts.ts) must match the wallet's `buildSwapInitiateFacts`. The live op
// is pinned against the same vector in extro-node's own suites.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtroCommand, ExtroResponse } from "@extro/node";
import { bootArkNode } from "$lib/ark/ark-node.testkit";

let send: (c: ExtroCommand) => Promise<ExtroResponse>;
vi.mock("$lib/extro", async (orig) => ({
  ...(await orig<object>()),
  getExtroClient: () => ({ send: (c: ExtroCommand) => send(c) }),
}));

import { buildSwapInitiateFacts, type BuildFactsInput } from "./swap-facts";

const require = createRequire(import.meta.url);
type Raw = {
  order_id: string;
  maker_fp: string;
  bearer: Record<string, string>;
  provider: Record<string, string>;
  bearer_seller: Record<string, string>;
  enc_secret_for_provider: string;
  prepared: Record<string, string>;
  expected_provider_fp_hex: string | null;
};
const v = JSON.parse(
  readFileSync(require.resolve("@extro/node/vectors/swap_facts.json"), "utf8"),
) as {
  cases: {
    name: string;
    input: Raw;
    expected: { error?: string; facts?: Record<string, unknown> };
  }[];
};

const hb = (h: string) =>
  Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const plain = (x: unknown): unknown =>
  x instanceof Uint8Array
    ? Array.from(x, (b) => b.toString(16).padStart(2, "0")).join("")
    : typeof x === "bigint"
      ? x.toString()
      : x && typeof x === "object"
        ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, plain(y)]))
        : x;
const typed = (b: Raw): BuildFactsInput =>
  ({
    order: { id: b.order_id, makerFingerprint: b.maker_fp },
    bearer: {
      publicTokenHash: hb(b.bearer.public_token_hash),
      bearerAmount: b.bearer.bearer_amount,
      fillAmountRaw: BigInt(b.bearer.fill_amount_raw),
    },
    provider: {
      ...b.provider,
      conditional_payload: hb(b.provider.conditional_payload),
    },
    bearerSeller: { ...b.bearer_seller },
    encSecretForProvider: hb(b.enc_secret_for_provider),
    prepared: {
      swapId: b.prepared.swap_id,
      requestCommitment: hb(b.prepared.request_commitment),
      idempotencyKey: hb(b.prepared.idempotency_key),
      expiresAtUnix: BigInt(b.prepared.expires_at_unix),
    },
    ...(b.expected_provider_fp_hex === null
      ? {}
      : { expectedProviderFpHex: b.expected_provider_fp_hex }),
  }) as never;
const outcome = async (
  f: () => unknown,
): Promise<{ ok: unknown } | { error: string }> => {
  try {
    return { ok: await f() };
  } catch (e) {
    return { error: (e as Error).message };
  }
};

beforeAll(async () => {
  send = (await bootArkNode()).send as never;
});

describe("swap facts: extro-node vector = wallet", () => {
  it("buildSwapInitiateFacts matches every swap_facts case", async () => {
    expect(v.cases.length).toBeGreaterThanOrEqual(45);
    for (const c of v.cases) {
      const got = await outcome(() => buildSwapInitiateFacts(typed(c.input)));
      if (c.expected.error) {
        expect(
          "error" in got && got.error.endsWith(c.expected.error),
          `${c.name}: ${JSON.stringify(plain(got))}`,
        ).toBe(true);
      } else {
        if (!("ok" in got)) throw new Error(`${c.name}: ${got.error}`);
        expect(plain(got.ok), c.name).toEqual(c.expected.facts);
        expect(
          typeof (got.ok as { fill_amount_raw: unknown }).fill_amount_raw,
          c.name,
        ).toBe("bigint");
      }
    }
  });
});
