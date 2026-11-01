// Parity gate (ADR-0007, audit H3): the referee REST client lives in
// extro-node (`Op::Exchange Referee`). Every `source: "pwa"` case of
// `@extro/node/vectors/referee_client.json` (oracle: this wallet's pre-switch
// HttpRefereeClient) must match the wallet's `HttpRefereeClient` — same HTTP
// request on the wire (global fetch stubbed), same reply or refusal. The
// "referee" cases (ack/audit shapes, fail-closed inputs) are pinned in
// extro-node's own suites.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtroCommand, ExtroResponse } from "@extro/node";
import { bootArkNode } from "$lib/ark/ark-node.testkit";

let send: (c: ExtroCommand) => Promise<ExtroResponse>;
vi.mock("$lib/extro", async (orig) => ({
  ...(await orig<object>()),
  getExtroClient: () => ({ send: (c: ExtroCommand) => send(c) }),
}));

import { HttpRefereeClient } from "./referee-client";

const require = createRequire(import.meta.url);
type Case = {
  name: string;
  source: "pwa" | "referee";
  base_url: string;
  pinned_vk_hex: string;
  call: { call: string; envelope?: string; swap_id?: string };
  response: { status: number; body_hex: string };
  expected: {
    request: { method: string; url: string; headers: [string, string][]; body_hex: string };
    reply?: Record<string, unknown>;
    error?: string;
  };
};
const v = JSON.parse(
  readFileSync(require.resolve("@extro/node/vectors/referee_client.json"), "utf8"),
) as { cases: Case[] };
const pwa = v.cases.filter((c) => c.source === "pwa");

const hb = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function run(client: HttpRefereeClient, c: Case): Promise<Record<string, unknown>> {
  switch (c.call.call) {
    case "Health": {
      const h = await client.health();
      return { reply: "Health", status: h.status, version: h.version };
    }
    case "Pubkey": {
      const p = await client.pubkey();
      return {
        reply: "Pubkey",
        ed25519_pubkey_hex: p.ed25519_pubkey_hex,
        musig2_pubshare_hex: p.musig2_pubshare_hex,
        referee_version: p.referee_version,
        capabilities: p.capabilities ?? null,
      };
    }
    case "Prepare":
      return { reply: "Prepared", signed: hex(await client.prepare(hb(c.call.envelope!))) };
    case "Initiate": {
      const r = await client.initiate(hb(c.call.envelope!));
      return { reply: "Initiated", swap_id: r.swap_id, phase: r.phase };
    }
    case "Advance": {
      const r = await client.advance(c.call.swap_id!);
      return { reply: "Advanced", swap_id: r.swapId, phase: r.phase, terminal: r.terminal };
    }
    default:
      throw new Error(`no pwa case for ${c.call.call}`);
  }
}

describe("HttpRefereeClient ≡ referee_client.json (pwa cases)", () => {
  beforeAll(async () => {
    send = (await bootArkNode()).send;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("covers the pre-switch client", () => {
    expect(pwa.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of pwa) {
    it(c.name, async () => {
      const seen: Case["expected"]["request"][] = [];
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        seen.push({
          method: req.method,
          url: req.url,
          headers: [...req.headers].filter(([k]) => k !== "content-length"),
          body_hex: hex(new Uint8Array(await req.arrayBuffer())),
        });
        return new Response(c.response.body_hex ? hb(c.response.body_hex) : null, {
          status: c.response.status,
        });
      });
      const client = new HttpRefereeClient({ baseUrl: c.base_url, pinnedPubkeyHex: c.pinned_vk_hex });
      let got: Record<string, unknown> | { error: string };
      try {
        got = await run(client, c);
      } catch (e) {
        got = { error: (e as Error).message };
      }
      expect(seen).toEqual([
        {
          ...c.expected.request,
          headers: c.expected.request.headers.map(([k, x]) => [k.toLowerCase(), x]),
        },
      ]);
      if (c.expected.error) {
        expect("error" in got ? got.error : JSON.stringify(got)).toContain(c.expected.error);
      } else {
        expect(got).toEqual(c.expected.reply);
      }
    });
  }
});
