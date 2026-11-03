import { describe, expect, it, vi } from "vitest";
import type { ExtroCommand, ExtroResponse } from "@extro/node";

vi.mock("$lib/stores/wallet.svelte", () => ({
  payWebcash: vi.fn(),
  insertWebcash: vi.fn(),
  parseAmount: vi.fn(),
}));
vi.mock("./index", () => ({ getExtroClient: vi.fn() }));

import {
  PriceChangedError,
  quoteRegistrationFee,
  registerExtroIdentity,
  type RegistrationDeps,
} from "./registration";

const ok = (body: unknown) =>
  ({
    kind: "Ok",
    request_id: new Uint8Array(16),
    body,
  }) as unknown as ExtroResponse;
const wats = async (s: string) => Math.round(Number(s) * 1e8);
const secret = "e0.0001:secret:" + "aa".repeat(32);

function deps(price: string, over: Partial<RegistrationDeps> = {}) {
  const sent: ExtroCommand[] = [];
  const send = vi.fn(async (cmd: ExtroCommand) => {
    sent.push(cmd);
    const c = (cmd.op as { cmd: { op: string } }).cmd;
    if (c.op === "Pin") return ok({ kind: "KeyserverPinned" });
    if (c.op === "Quote")
      return ok({
        kind: "RegistrationQuote",
        rail: "webcash",
        amount: price,
        expires_at_unix: 1,
      });
    if (c.op === "Register")
      return ok({
        kind: "IdentityRegistered",
        fingerprint_hex: "AB".repeat(20),
        nickname: "alice",
        registered_at_unix: 2,
      });
    throw new Error("unexpected " + c.op);
  });
  const d = {
    send,
    keyserver: {
      url: "https://ks.example",
      domain: "ks.example",
      fingerprint_hex: "cd".repeat(20),
      vk_hex: "ef".repeat(32),
    },
    selfFingerprint: async () =>
      "ab".repeat(20) + Math.random().toString(16).slice(2, 6),
    parseAmount: wats,
    pay: vi.fn(async () => ({ ok: true as const, value: secret })),
    insert: vi.fn(async () => undefined),
    ...over,
  };
  return { d, sent, send };
}

const ops = (sent: ExtroCommand[]) =>
  sent.map((c) => (c.op as { cmd: { op: string } }).cmd.op);

describe("registration fee comes from the key server", () => {
  it("quotes the price the key server publishes, after pinning its anchor", async () => {
    const { d, sent } = deps("0.0001");
    expect(await quoteRegistrationFee(d)).toEqual({
      rail: "webcash",
      amount: "0.0001",
      expires_at_unix: 1,
    });
    expect(ops(sent)).toEqual(["Pin", "Quote"]);
    const { d: d6 } = deps("6");
    expect((await quoteRegistrationFee(d6)).amount).toBe("6");
  });

  it("pays exactly the quoted amount and registers with that bearer secret", async () => {
    const { d, sent } = deps("6");
    const r = await registerExtroIdentity("alice", "6", d);
    expect(r.nickname).toBe("alice");
    expect(d.pay).toHaveBeenCalledWith(600_000_000);
    expect(ops(sent)).toEqual(["Pin", "Quote", "Register"]);
    const reg = (sent[2].op as { cmd: { bearer_secret: string; rail: string } })
      .cmd;
    expect(reg).toMatchObject({ bearer_secret: secret, rail: "webcash" });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("pays nothing when the key server price changed since it was shown", async () => {
    const { d, sent } = deps("6");
    const err = await registerExtroIdentity("alice", "0.0001", d).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(PriceChangedError);
    expect((err as PriceChangedError).quote.amount).toBe("6");
    expect(d.pay).not.toHaveBeenCalled();
    expect(ops(sent)).not.toContain("Register");
  });

  it("pays nothing when the quote fails", async () => {
    const { d, send } = deps("6");
    send.mockImplementation(async (cmd: ExtroCommand) => {
      const c = (cmd.op as { cmd: { op: string } }).cmd;
      if (c.op === "Pin") return ok({ kind: "KeyserverPinned" });
      return {
        kind: "Err",
        request_id: new Uint8Array(16),
        code: "Keyserver",
        message:
          'quote: challenge webcash price "usd:6.00" is not a decimal amount',
      } as unknown as ExtroResponse;
    });
    await expect(registerExtroIdentity("alice", "6", d)).rejects.toThrow(
      /not a decimal amount/,
    );
    expect(d.pay).not.toHaveBeenCalled();
  });

  it("re-inserts the fee when registration fails", async () => {
    const { d, send } = deps("0.0001");
    const base = send.getMockImplementation()!;
    send.mockImplementation(async (cmd: ExtroCommand) => {
      const c = (cmd.op as { cmd: { op: string } }).cmd;
      if (c.op === "Register")
        return {
          kind: "Err",
          request_id: new Uint8Array(16),
          code: "Keyserver",
          message: "retry status 422",
        } as unknown as ExtroResponse;
      return base(cmd);
    });
    await expect(registerExtroIdentity("alice", "0.0001", d)).rejects.toThrow(
      /422/,
    );
    expect(d.pay).toHaveBeenCalledWith(10_000);
    expect(d.insert).toHaveBeenCalledWith(secret);
  });
});
