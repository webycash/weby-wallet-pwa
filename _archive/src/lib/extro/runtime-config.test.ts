import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "./runtime-config";

// The published phase-2 MPC ceremony (extro-circuits circuits-mpc/MANIFEST @267a5f9).
const MPC_PROFILE = "mpc-2026-10-31";
const MPC_BEARER_VK =
  "7de9aac9e4e4e880d32eacb06c717c9c59f1d251ebc71de1daddbf76acd66220";
const MPC_CONDITIONAL_VK =
  "084837739c4fa0c0e12a60da8aabb6d0fdf198d9ce7c443ce00bc27271710db2";

const development = () => ({
  schema_version: 2,
  deployment: "development",
  db_name: "extro-node-test",
  adapter_mode: "bundled",
  keyserver_url: "https://dev.extro.network",
  keyserver_domain: "dev.extro.network",
  keyserver_fingerprint_hex: "11".repeat(20),
  keyserver_vk_hex: "22".repeat(32),
  referee_url: "https://dev.weby.cash/api/referee",
  referee_vk_hex: "33".repeat(32),
  webcash_server_url: "https://dev.weby.cash/api/webcash",
  voucher_server_url: "https://dev.weby.cash/api/voucher",
  rgb_server_url: "https://dev.weby.cash/api/rgb",
  rgb_collectible_server_url: "https://dev.weby.cash/api/rgb-collectible",
  ark_enabled: false,
  ark_network: "signet",
  ark_asp_url: "",
  ark_signer_pk_hex: "",
  ark_info_digest_hex: "",
  ark_checkpoint_tapscript_hex: "",
  ark_unilateral_exit_delay: 0,
  zkp_profile: "development-only",
  zkp_bearer_vk_sha256:
    "ecd299b3326e682106a31a39decf1fb43c0d5b960eb40baa2975691f406f77c1",
  zkp_conditional_vk_sha256:
    "8efdd75f738658f3da0308fac3cbf6912c1324e815d863548c7e82ba39d07f1d",
  ice_servers: ["stun:stun.cloudflare.com:3478"],
  turn_servers: [
    {
      url: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
});

describe("strict runtime configuration", () => {
  it("accepts the explicit development schema", () => {
    expect(parseRuntimeConfig(development()).deployment).toBe("development");
  });

  it("names missing and unknown fields", () => {
    const missing = development();
    delete (missing as Partial<typeof missing>).referee_vk_hex;
    expect(() => parseRuntimeConfig(missing)).toThrow(
      "missing field `referee_vk_hex`",
    );
    expect(() =>
      parseRuntimeConfig({ ...development(), surprise: true }),
    ).toThrow("unknown field `surprise`");
  });

  it("rejects mock adapters and zero pins", () => {
    expect(() =>
      parseRuntimeConfig({ ...development(), adapter_mode: "mock" }),
    ).toThrow("adapter_mode must be `bundled`");
    expect(() =>
      parseRuntimeConfig({
        ...development(),
        keyserver_vk_hex: "0".repeat(64),
      }),
    ).toThrow("must not be all zero");
  });

  it("rejects dormant Ark trust material when Ark is disabled", () => {
    expect(() =>
      parseRuntimeConfig({
        ...development(),
        ark_info_digest_hex: "44".repeat(32),
      }),
    ).toThrow("Ark trust fields must be empty/zero");
  });

  it("rejects dev ceremony and public TURN in production", () => {
    const production = {
      ...development(),
      deployment: "production",
      ark_enabled: true,
      ark_network: "bitcoin",
      ark_asp_url: "https://ark.example.com",
      ark_signer_pk_hex: "44".repeat(32),
      ark_info_digest_hex: "45".repeat(32),
      ark_checkpoint_tapscript_hex: "46".repeat(32),
      ark_unilateral_exit_delay: 605184,
    };
    expect(() => parseRuntimeConfig(production)).toThrow(
      "development-only ZKP",
    );

    production.zkp_profile = MPC_PROFILE;
    production.zkp_bearer_vk_sha256 = MPC_BEARER_VK;
    production.zkp_conditional_vk_sha256 = MPC_CONDITIONAL_VK;
    expect(() => parseRuntimeConfig(production)).toThrow("Open Relay");
  });

  it("rejects localhost and non-HTTPS production endpoints", () => {
    const production = {
      ...development(),
      deployment: "production",
      keyserver_url: "http://localhost:7800",
      keyserver_domain: "localhost",
      ark_enabled: true,
      ark_network: "bitcoin",
      ark_asp_url: "https://ark.example.com",
      ark_signer_pk_hex: "44".repeat(32),
      ark_info_digest_hex: "45".repeat(32),
      ark_checkpoint_tapscript_hex: "46".repeat(32),
      ark_unilateral_exit_delay: 605184,
      zkp_profile: MPC_PROFILE,
      zkp_bearer_vk_sha256: MPC_BEARER_VK,
      zkp_conditional_vk_sha256: MPC_CONDITIONAL_VK,
      turn_servers: [
        {
          url: "turns:turn.example.com:443",
          username: "short",
          credential: "lived",
        },
      ],
    };
    expect(() => parseRuntimeConfig(production)).toThrow(
      "must use https in production",
    );
  });
  const mainnetArk = {
    ark_enabled: true,
    ark_network: "bitcoin",
    ark_asp_url: "https://arkade.computer",
    ark_signer_pk_hex:
      "8202bebddeb1f7442803897a85eaf3ce9254d07df0172fc3725ab5f0d097779c",
    ark_info_digest_hex:
      "6f4148f0aafe75ff8046f314d75a87ddf17ad0659f37af55746498104fde3589",
    ark_checkpoint_tapscript_hex:
      "039e0440b27520b43a8363118c084a04d4f6a50ebfa58e81957f8cceceb2aee0ab64c9fd2d9977ac",
    ark_unilateral_exit_delay: 605184,
  };

  it("keeps development blocked from Ark on bitcoin mainnet", () => {
    expect(() =>
      parseRuntimeConfig({ ...development(), ...mainnetArk }),
    ).toThrow("development cannot enable Ark on bitcoin mainnet");
  });

  const productionTrust = {
    zkp_profile: MPC_PROFILE,
    zkp_bearer_vk_sha256: MPC_BEARER_VK,
    zkp_conditional_vk_sha256: MPC_CONDITIONAL_VK,
    turn_servers: [
      {
        url: "turns:turn.extro.network:5349",
        username: "extro",
        credential: "managed",
      },
    ],
  };

  // Audit C4: staging moves real value, so it carries the production trust set.
  it("staging mainnet rejects the dev ceremony and public TURN", () => {
    const staging = { ...development(), ...mainnetArk, deployment: "staging" };
    expect(() => parseRuntimeConfig(staging)).toThrow("development-only ZKP");
    expect(() =>
      parseRuntimeConfig({ ...staging, zkp_profile: MPC_PROFILE }),
    ).toThrow("development-ceremony VK");
    expect(() =>
      parseRuntimeConfig({
        ...staging,
        ...productionTrust,
        turn_servers: development().turn_servers,
      }),
    ).toThrow("Open Relay");
    expect(() =>
      parseRuntimeConfig({ ...staging, ...productionTrust, turn_servers: [] }),
    ).toThrow("managed TURN");
    // Webcash is mainnet in staging even with Ark off.
    expect(() =>
      parseRuntimeConfig({ ...development(), deployment: "staging" }),
    ).toThrow("development-only ZKP");
  });

  it("mainnet tiers accept only the pinned ceremony and its exact VKs", () => {
    const dev = development();
    for (const deployment of ["staging", "production"] as const) {
      const base = { ...dev, ...mainnetArk, ...productionTrust, deployment };
      // Dev VKs are refused even when relabelled as the MPC profile.
      expect(() =>
        parseRuntimeConfig({
          ...base,
          zkp_bearer_vk_sha256: dev.zkp_bearer_vk_sha256,
          zkp_conditional_vk_sha256: dev.zkp_conditional_vk_sha256,
        }),
      ).toThrow("development-ceremony VK");
      expect(() =>
        parseRuntimeConfig({ ...base, zkp_profile: "mpc-unpublished" }),
      ).toThrow("not a ceremony published");
      expect(() =>
        parseRuntimeConfig({ ...base, zkp_bearer_vk_sha256: "55".repeat(32) }),
      ).toThrow("not the pinned mpc-2026-10-31");
      expect(() =>
        parseRuntimeConfig({
          ...base,
          zkp_conditional_vk_sha256: MPC_BEARER_VK,
        }),
      ).toThrow("not the pinned mpc-2026-10-31");
    }
  });

  it("staging with the production trust set requires bitcoin Ark and https", () => {
    const staging = {
      ...development(),
      ...mainnetArk,
      ...productionTrust,
      deployment: "staging",
    };
    const cfg = parseRuntimeConfig(staging);
    expect(cfg.deployment).toBe("staging");
    expect(cfg.ark_network).toBe("bitcoin");
    expect(() =>
      parseRuntimeConfig({ ...staging, ark_network: "signet" }),
    ).toThrow("ark_network must be `bitcoin` in staging");
    expect(() =>
      parseRuntimeConfig({
        ...staging,
        referee_url: "http://staging.weby.cash/api/referee",
      }),
    ).toThrow("must use https in staging");
  });
});
