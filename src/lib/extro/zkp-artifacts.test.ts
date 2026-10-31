import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_VK_SHA256,
  zkpArtifacts,
  zkpTrustRoot,
} from "./zkp-artifacts";

describe("zkp-artifacts manifest", () => {
  it("pins the development ceremony keys under circuits-dev", () => {
    const dev = zkpArtifacts("development-only");
    expect(dev.dir).toBe("circuits-dev");
    expect(dev.bearerSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(dev.conditionalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pins the mpc-2026-10-31 ceremony for mainnet tiers only", () => {
    const mpc = zkpArtifacts("mpc-2026-10-31");
    expect(mpc.dir).toBe("circuits-mpc");
    expect(mpc.bearerSha256).toBe(
      "c228404b2f5f7cab20dcf3ce3523678b86a5f8700081cf713948f13d52b016f4",
    );
    expect(mpc.conditionalSha256).toBe(
      "4cff96e08298492bf59f39a69bb588ddb370e5dd8ffb3d92e9121cad37884328",
    );
    expect(zkpTrustRoot("mpc-2026-10-31")).toEqual({
      tiers: ["staging", "production"],
      bearerVkSha256:
        "7de9aac9e4e4e880d32eacb06c717c9c59f1d251ebc71de1daddbf76acd66220",
      conditionalVkSha256:
        "084837739c4fa0c0e12a60da8aabb6d0fdf198d9ce7c443ce00bc27271710db2",
    });
  });

  it("marks the development ceremony VKs as forgeable and development-only", () => {
    const dev = zkpTrustRoot("development-only");
    expect(dev?.tiers).toEqual(["development"]);
    expect(DEVELOPMENT_VK_SHA256.has(dev!.bearerVkSha256)).toBe(true);
    expect(DEVELOPMENT_VK_SHA256.has(dev!.conditionalVkSha256)).toBe(true);
    expect(DEVELOPMENT_VK_SHA256.size).toBe(2);
    expect(zkpTrustRoot("__proto__")).toBeNull();
  });

  it("refuses profiles without published keys", () => {
    expect(() => zkpArtifacts("mpc-unknown")).toThrow(/no pinned proving keys/);
    expect(() => zkpArtifacts("__proto__")).toThrow(/no pinned proving keys/);
  });
});
