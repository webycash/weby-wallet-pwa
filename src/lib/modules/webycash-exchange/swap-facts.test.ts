import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtroCommand, ExtroResponse } from "@extro/node";
import { bootArkNode } from "$lib/ark/ark-node.testkit";

// The checks run in extro-node (`Op::Exchange SwapFacts`); drive the real op.
let send: (c: ExtroCommand) => Promise<ExtroResponse>;
vi.mock("$lib/extro", async (orig) => ({
  ...(await orig<object>()),
  getExtroClient: () => ({ send: (c: ExtroCommand) => send(c) }),
}));
beforeAll(async () => {
  send = (await bootArkNode()).send as never;
});

import type { LimitOrder } from "./types";
import {
  assertLegMatchesOrder,
  bearerAssetFor,
  buildSwapInitiateFacts,
  type BearerLeg,
  type BearerSellerIdentity,
  type PreparedSwapBinding,
  type ProviderMaterial,
} from "./swap-facts";

const makerFingerprint = "11".repeat(20);
const providerPubkey = "02" + "22".repeat(32);
const publicNonce = "02" + "33".repeat(32) + "03" + "44".repeat(32);

const order: LimitOrder = {
  id: "55".repeat(16),
  pair: { base: "BitcoinArk", quote: "Webcash" },
  side: "sell",
  price: 1,
  amount: 1,
  makerFingerprint,
  makerVk: "66".repeat(32),
  expiresAt: 4_000_000_000,
  observedAt: 2_000_000_000,
  source: "dhtx",
  signedCommitment: "signed",
};

const bearer: BearerLeg = {
  publicTokenHash: new Uint8Array(32).fill(0x77),
  bearerAmount: "1",
  fillAmountRaw: 1n,
  asset: { family: "Webcash" },
};

const bearerSeller: BearerSellerIdentity = {
  bearer_seller_fp: "88".repeat(20),
  bearer_seller_pgp_pubkey: "99".repeat(32),
  bearer_seller_cancel_pubkey_hex: "aa".repeat(32),
};

const conditionalPayload = (): Uint8Array => {
  const payload = new Uint8Array(128);
  const ciphertext = new Uint8Array(64).fill(0xbb);
  new DataView(payload.buffer).setUint32(0, ciphertext.length, false);
  payload.set(ciphertext, 4);
  return payload;
};

const provider = (): ProviderMaterial => ({
  musig2_pubkey: providerPubkey,
  settle_nonce: publicNonce,
  refund_nonce: publicNonce,
  provider_fp: makerFingerprint,
  provider_pgp_pubkey: "cc".repeat(32),
  provider_cancel_pubkey_hex: "dd".repeat(32),
  locked_ref: `${"ee".repeat(32)}:0`,
  tx_settle_hash_hex: "12".repeat(32),
  tx_refund_hash_hex: "34".repeat(32),
  conditional_payload: conditionalPayload(),
});

const encryptedSecret = (): Uint8Array => new Uint8Array(80).fill(0xab);
const prepared = (): PreparedSwapBinding => ({
  swapId: "prepared-fixture",
  requestCommitment: new Uint8Array(32).fill(0x41),
  idempotencyKey: new Uint8Array(16).fill(0x42),
  expiresAtUnix: 4_000_000_000n,
});

describe("buildSwapInitiateFacts fail-closed boundary", () => {
  it("accepts a complete, internally consistent prepared-contract shape", async () => {
    const facts = await buildSwapInitiateFacts({
      order,
      bearer,
      provider: provider(),
      bearerSeller,
      encSecretForProvider: encryptedSecret(),
      prepared: prepared(),
    });

    expect(facts.prepared_swap_id).toBe("prepared-fixture");
    expect(facts.prepare_request_commitment).toEqual(
      new Uint8Array(32).fill(0x41),
    );
    expect(facts.idempotency_key).toBe("42".repeat(16));
    expect(facts.locked_ref).toBe(`${"ee".repeat(32)}:0`);
    expect(facts.provider_musig2_pubkey).toBe(providerPubkey);
    expect(facts.conditional_payload).toHaveLength(128);
    expect(facts.bearer_asset).toEqual({ family: "Webcash" });
  });

  it("carries a namespaced voucher bearer asset through", async () => {
    const voucher = {
      family: "Voucher" as const,
      contract_id: "credits",
      issuer_fp: "CD".repeat(20),
    };
    const facts = await buildSwapInitiateFacts({
      order,
      bearer: { ...bearer, asset: voucher },
      provider: provider(),
      bearerSeller,
      encSecretForProvider: encryptedSecret(),
      prepared: prepared(),
    });
    expect(facts.bearer_asset).toEqual(voucher);
  });

  it("refuses a bearer leg without an asset", async () => {
    const { asset: _drop, ...noAsset } = bearer;
    await expect(
      buildSwapInitiateFacts({
        order,
        bearer: noAsset as BearerLeg,
        provider: provider(),
        bearerSeller,
        encSecretForProvider: encryptedSecret(),
        prepared: prepared(),
      }),
    ).rejects.toThrow();
  });

  it("rejects the former missing-provider-field fallback path", async () => {
    const incomplete = {
      musig2_pubkey: providerPubkey,
      settle_nonce: publicNonce,
      refund_nonce: publicNonce,
    } as ProviderMaterial;

    await expect(
      buildSwapInitiateFacts({
        order,
        bearer,
        provider: incomplete,
        bearerSeller,
        encSecretForProvider: encryptedSecret(),
        prepared: prepared(),
      }),
    ).rejects.toThrow(/provider_fp/);
  });

  it("rejects the old public hash plus provider-key encryption substitute", async () => {
    const publicSubstitute = new Uint8Array(64);
    publicSubstitute.set(bearer.publicTokenHash);
    publicSubstitute.set(new Uint8Array(32).fill(0xcc), 32);

    await expect(
      buildSwapInitiateFacts({
        order,
        bearer,
        provider: provider(),
        bearerSeller,
        encSecretForProvider: publicSubstitute,
        prepared: prepared(),
      }),
    ).rejects.toThrow(/not ciphertext/);
  });

  it("rejects a dummy locked reference and an unframed conditional payload", async () => {
    await expect(
      buildSwapInitiateFacts({
        order,
        bearer,
        provider: { ...provider(), locked_ref: "v".repeat(64) },
        bearerSeller,
        encSecretForProvider: encryptedSecret(),
        prepared: prepared(),
      }),
    ).rejects.toThrow(/locked_ref/);

    await expect(
      buildSwapInitiateFacts({
        order,
        bearer,
        provider: {
          ...provider(),
          conditional_payload: new Uint8Array(128).fill(0xdd),
        },
        bearerSeller,
        encSecretForProvider: encryptedSecret(),
        prepared: prepared(),
      }),
    ).rejects.toThrow(/framed ciphertext length/);
  });

  it("rejects a missing or malformed prepare allocation before initiate", async () => {
    const base = {
      order,
      bearer,
      provider: provider(),
      bearerSeller,
      encSecretForProvider: encryptedSecret(),
    };
    await expect(
      buildSwapInitiateFacts({
        ...base,
        prepared: undefined as unknown as PreparedSwapBinding,
      }),
    ).rejects.toThrow(/prepared_swap_id/);
    await expect(
      buildSwapInitiateFacts({
        ...base,
        prepared: { ...prepared(), requestCommitment: new Uint8Array(31) },
      }),
    ).rejects.toThrow(/prepare_request_commitment/);
    await expect(
      buildSwapInitiateFacts({
        ...base,
        prepared: { ...prepared(), idempotencyKey: new Uint8Array(16) },
      }),
    ).rejects.toThrow(/idempotency_key.*zero/);
  });
});

describe("bearer asset from the order", () => {
  const ord = (base: string, quote: string) =>
    ({ ...order, pair: { base, quote } }) as LimitOrder;
  it("is Webcash for an Ark/Webcash pair on either side", () => {
    expect(bearerAssetFor(ord("BitcoinArk", "Webcash"))).toEqual({
      family: "Webcash",
    });
    expect(bearerAssetFor(ord("Webcash", "BitcoinArk"))).toEqual({
      family: "Webcash",
    });
  });
  it("takes a voucher order's signed contract + issuer", () => {
    const v = {
      family: "Voucher" as const,
      contract_id: "c-1",
      issuer_fp: "AB".repeat(20),
    };
    const o = {
      ...ord("BitcoinArk", "Voucher"),
      assets: { base: { family: "BitcoinArk" as const }, quote: v },
    };
    expect(bearerAssetFor(o)).toEqual(v);
    const flipped = {
      ...ord("Voucher", "BitcoinArk"),
      assets: { base: v, quote: { family: "BitcoinArk" as const } },
    };
    expect(bearerAssetFor(flipped)).toEqual(v);
  });
  it("fails closed for a voucher order without a signed namespace", () => {
    expect(() => bearerAssetFor(ord("BitcoinArk", "Voucher"))).toThrow(
      /^BEARER_ASSET_UNNAMESPACED/,
    );
    const bare = {
      ...ord("BitcoinArk", "Voucher"),
      assets: {
        base: { family: "BitcoinArk" as const },
        quote: { family: "Voucher" as const },
      },
    };
    expect(() => bearerAssetFor(bare)).toThrow(/^BEARER_ASSET_UNNAMESPACED/);
  });
  it("refuses a pair without an Ark/bearer leg", () => {
    expect(() => bearerAssetFor(ord("Webcash", "Rgb20"))).toThrow(
      /^BEARER_ASSET_UNSUPPORTED/,
    );
  });
  it("refuses a wallet leg whose asset is not the order's", () => {
    expect(assertLegMatchesOrder(bearer, order)).toBe(bearer);
    const v = {
      ...bearer,
      asset: {
        family: "Voucher" as const,
        contract_id: "c",
        issuer_fp: "cd".repeat(20),
      },
    };
    expect(() => assertLegMatchesOrder(v, order)).toThrow(
      /^BEARER_ASSET_MISMATCH/,
    );
  });
});
