// Parity gate (ADR-0007, audit H3): the provider-material checks live in
// extro-node (`Op::Exchange SwapProviderMaterial`). Every case of
// `@extro/node/vectors/provider_material.json` (oracle: this wallet's
// pre-switch providerMaterialFromWire) must match the wallet's
// `providerMaterialFromWire`. The live op is pinned against the same vector in
// extro-node's own suites.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtroCommand, ExtroResponse, WireProviderMaterial } from "@extro/node";
import { bootArkNode } from "$lib/ark/ark-node.testkit";

let send: (c: ExtroCommand) => Promise<ExtroResponse>;
vi.mock("$lib/extro", async (orig) => ({
  ...(await orig<object>()),
  getExtroClient: () => ({ send: (c: ExtroCommand) => send(c) }),
}));

import { providerMaterialFromWire } from "./accept-run-swap";

const require = createRequire(import.meta.url);
type Raw = { wire: Record<string, string>; conditional_payload: string };
const v = JSON.parse(
  readFileSync(require.resolve("@extro/node/vectors/provider_material.json"), "utf8"),
) as {
  cases: {
    name: string;
    input: Raw;
    expected: { error?: string; material?: Record<string, string> };
  }[];
};

const hb = (h: string) =>
  Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const plain = (x: unknown): unknown =>
  x instanceof Uint8Array
    ? Array.from(x, (b) => b.toString(16).padStart(2, "0")).join("")
    : x && typeof x === "object"
      ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, plain(y)]))
      : x;
const wire = (w: Record<string, string>): WireProviderMaterial =>
  ({
    ...w,
    order_id: hb(w.order_id),
    provider_fp: hb(w.provider_fp),
    provider_pgp_pubkey: hb(w.provider_pgp_pubkey),
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

describe("provider material: extro-node vector = wallet", () => {
  it("providerMaterialFromWire matches every provider_material case", async () => {
    expect(v.cases.length).toBeGreaterThanOrEqual(32);
    for (const c of v.cases) {
      const got = await outcome(() =>
        providerMaterialFromWire(wire(c.input.wire), hb(c.input.conditional_payload)),
      );
      if (c.expected.error) {
        expect(
          "error" in got && got.error.endsWith(c.expected.error),
          `${c.name}: ${JSON.stringify(plain(got))}`,
        ).toBe(true);
      } else {
        if (!("ok" in got)) throw new Error(`${c.name}: ${got.error}`);
        expect(plain(got.ok), c.name).toEqual(c.expected.material);
        expect((got.ok as { conditional_payload: unknown }).conditional_payload, c.name).toBeInstanceOf(Uint8Array);
      }
    }
  });
});
