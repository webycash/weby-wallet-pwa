#!/usr/bin/env node
// Release trust guard (audit C4, RA Gate 1.4 / 5.4).
//
// Every Wrangler config whose PUBLIC_DEPLOYMENT is a mainnet tier (`staging`,
// `production`) must not carry development trust roots: the deterministic
// development Groth16 ceremony (reproducible from a public seed, so anyone can
// forge proofs), the `development-only` ZKP profile, public Open Relay TURN, or
// development keyserver/referee/voucher/RGB hosts. The runtime validators
// (extro-node `WasmBootConfigV2::validate`, `parseRuntimeConfig`) refuse such a
// boot; this guard stops the config from being committed in the first place.
//
// It also pins the ceremony positively: a mainnet config must name a ZKP profile
// that `zkp-artifacts.json` publishes for its tier, with exactly that profile's
// VK fingerprints. With `--deploy` (run right before `wrangler deploy`) the
// config must also be complete: no `REPLACE_ME` placeholder may remain.
//
// Usage: node scripts/check-release-trust.mjs [--deploy] [file ...]   (default: ./wrangler*.toml)
import { readdirSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("zkp-artifacts.json", "utf8"));
const PLACEHOLDER = "REPLACE_ME";

/** SHA-256 of the development ceremony VKs (extro-node DEV_CEREMONY_VK_FINGERPRINTS). */
const DEV_VK_FINGERPRINTS = [
  "ecd299b3326e682106a31a39decf1fb43c0d5b960eb40baa2975691f406f77c1",
  "8efdd75f738658f3da0308fac3cbf6912c1324e815d863548c7e82ba39d07f1d",
];

const FORBIDDEN = [
  ...DEV_VK_FINGERPRINTS.map((fp) => [
    fp,
    "development-ceremony VK fingerprint",
  ]),
  ["development-only", "development-only ZKP profile"],
  ["openrelay.metered.ca", "public Open Relay TURN"],
  ["openrelayproject", "public Open Relay TURN credentials"],
  ["dev.extro.network", "development keyserver host"],
  ["dev.weby.cash", "development referee/voucher/RGB host"],
];

const MAINNET_TIERS = new Set(["staging", "production"]);

/** Trust pins: verifying keys and fingerprints a release must not share with development. */
const TRUST_PIN_KEY = /^(PUBLIC_[A-Z0-9_]*(_VK|_VK_SHA256|_FINGERPRINT))$/;

function vars(text) {
  const out = new Map();
  for (const m of text.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm))
    out.set(m[1], m[2]);
  return out;
}

function deploymentOf(text) {
  const m = text.match(/^\s*PUBLIC_DEPLOYMENT\s*=\s*"([^"]*)"/m);
  return m ? m[1] : null;
}

const args = process.argv.slice(2);
const deploy = args.includes("--deploy");
const named = args.filter((a) => a !== "--deploy");
const files =
  named.length > 0
    ? named
    : readdirSync(".").filter((f) => /^wrangler.*\.toml$/.test(f));

const allWrangler = readdirSync(".").filter((f) =>
  /^wrangler.*\.toml$/.test(f),
);
const devPins = new Map();
for (const file of allWrangler) {
  const text = readFileSync(file, "utf8");
  if (deploymentOf(text) !== "development") continue;
  for (const [key, value] of vars(text)) {
    if (TRUST_PIN_KEY.test(key) && value)
      devPins.set(value.toLowerCase(), `${file} ${key}`);
  }
}

const violations = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const tier = deploymentOf(text);
  if (tier === null) {
    violations.push(
      `${file}: no PUBLIC_DEPLOYMENT; every release config names its tier`,
    );
    continue;
  }
  if (!MAINNET_TIERS.has(tier)) continue;
  for (const [key, value] of vars(text)) {
    const dev = TRUST_PIN_KEY.test(key) && devPins.get(value.toLowerCase());
    if (dev)
      violations.push(
        `${file}: ${key} reuses the development trust pin (${dev})`,
      );
  }
  violations.push(...ceremonyPinViolations(file, tier, vars(text)));
  text.split("\n").forEach((line, i) => {
    if (deploy && !/^\s*#/.test(line) && line.includes(PLACEHOLDER))
      violations.push(
        `${file}:${i + 1}: unfilled ${PLACEHOLDER} in ${tier} deploy`,
      );
    if (/^\s*#/.test(line)) return;
    for (const [needle, what] of FORBIDDEN) {
      if (line.toLowerCase().includes(needle)) {
        violations.push(`${file}:${i + 1}: ${what} in ${tier} config`);
      }
    }
  });
}

/**
 * A mainnet config's ZKP profile must be published for its tier in
 * zkp-artifacts.json and carry exactly that profile's VK fingerprints (mirrors
 * `parseRuntimeConfig` and extro-node `validate_mainnet_trust_set`).
 */
function ceremonyPinViolations(file, tier, v) {
  const name = v.get("PUBLIC_ZKP_PROFILE");
  if (name === undefined || name.includes(PLACEHOLDER)) return [];
  const profile = Object.hasOwn(manifest.profiles, name)
    ? manifest.profiles[name]
    : undefined;
  if (!profile?.tiers?.includes(tier))
    return [
      `${file}: PUBLIC_ZKP_PROFILE \`${name}\` is not a ceremony published for ${tier}`,
    ];
  const out = [];
  for (const [key, pinned] of [
    ["PUBLIC_ZKP_BEARER_VK_SHA256", profile.vk_sha256.bearer_payload],
    ["PUBLIC_ZKP_CONDITIONAL_VK_SHA256", profile.vk_sha256.conditional_leg],
  ]) {
    if (v.get(key)?.toLowerCase() !== pinned)
      out.push(`${file}: ${key} is not the pinned ${name} VK fingerprint`);
  }
  return out;
}

if (violations.length > 0) {
  console.error(
    "Release trust guard failed:\n" +
      violations.map((v) => `  ${v}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  `Release trust guard${deploy ? " (deploy)" : ""}: ${files.length} wrangler config(s) clean`,
);
