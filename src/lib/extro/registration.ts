// Paid keyserver identity registration (browser product path).
//
// The price is the key server's, never the app's: the node's
// `Keyserver/Quote` reads it from a fresh 402 challenge verified against the
// pinned keyserver anchor, the UI shows it, and registration pays exactly
// that amount (re-quoted at pay time; a changed price is refused, not paid).
//
// The in-browser extro-node has no native rail actors, so the PWA wallet
// settles the fee itself: `payWebcash` replaces a slice of the wallet's
// balance into a FRESH single-use output of exactly the quoted amount and
// hands that bearer secret to the node's `Keyserver/Register` command. The
// node verifies the signed challenge, signs the retry with the slot-0
// identity key (which never leaves WASM) and verifies the signed receipt. The
// bearer secret is never logged or persisted by this module; if registration
// fails before the keyserver redeems it, it is re-inserted so the fee is not
// lost.

import { getExtroClient } from "./index";
import {
  isOk,
  newRequestId,
  type ExtroCommand,
  type ExtroResponse,
} from "@extro/node";
import { getRuntimeConfig } from "$lib/extro/release-config";
import { getSelfIdentity } from "./self-identity";
import {
  payWebcash,
  insertWebcash,
  parseAmount,
} from "$lib/stores/wallet.svelte";

/** The registration price the key server publishes (from its signed 402 challenge). */
export interface RegistrationQuote {
  rail: "webcash";
  /** Canonical decimal webcash amount — exactly what the key server redeems. */
  amount: string;
  expires_at_unix: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** What registration needs from the app; injectable for tests. */
export interface RegistrationDeps {
  send: (cmd: ExtroCommand) => Promise<ExtroResponse>;
  keyserver: {
    url: string;
    domain: string;
    fingerprint_hex: string;
    vk_hex: string;
  };
  selfFingerprint: () => Promise<string>;
  parseAmount: (s: string) => Promise<number>;
  pay: (wats: number) => Promise<Result<string>>;
  insert: (secret: string) => Promise<unknown>;
}

function defaultDeps(): RegistrationDeps {
  const cfg = getRuntimeConfig();
  const client = getExtroClient();
  return {
    send: (cmd) => client.send(cmd),
    keyserver: {
      url: cfg.keyserver_url,
      domain: cfg.keyserver_domain,
      fingerprint_hex: cfg.keyserver_fingerprint_hex,
      vk_hex: cfg.keyserver_vk_hex,
    },
    selfFingerprint: async () =>
      (await getSelfIdentity(client, 0)).fingerprintHex,
    parseAmount,
    pay: payWebcash,
    insert: insertWebcash,
  };
}

export interface IdentityRegistration {
  fingerprint_hex: string;
  nickname: string;
  registered_at_unix: number;
}

const REGISTERED_KEY = "extro_identity_registered_v1";

/**
 * Whether THIS browser completed a registration for `fingerprintHex`.
 * Client transport is WebRTC-only (ADR-0001): the PWA never queries the
 * keyserver's HTTP record API itself; the node's signed receipt is the proof
 * and only its non-secret summary is remembered here.
 */
export function isIdentityRegistered(fingerprintHex: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const map = JSON.parse(
      localStorage.getItem(REGISTERED_KEY) ?? "{}",
    ) as Record<string, unknown>;
    return Boolean(map[fingerprintHex.toLowerCase()]);
  } catch {
    return false;
  }
}

function rememberRegistered(r: IdentityRegistration): void {
  if (typeof localStorage === "undefined") return;
  try {
    const map = JSON.parse(
      localStorage.getItem(REGISTERED_KEY) ?? "{}",
    ) as Record<string, unknown>;
    map[r.fingerprint_hex.toLowerCase()] = {
      nickname: r.nickname,
      at: r.registered_at_unix,
    };
    localStorage.setItem(REGISTERED_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable: the keyserver record is still authoritative.
  }
}

async function pin(d: RegistrationDeps): Promise<void> {
  const pinned = await d.send({
    request_id: newRequestId(),
    op: {
      kind: "Keyserver",
      cmd: {
        op: "Pin",
        base_url: d.keyserver.url,
        domain: d.keyserver.domain,
        fingerprint_hex: d.keyserver.fingerprint_hex,
        vk_hex: d.keyserver.vk_hex,
      },
    },
  });
  if (!isOk(pinned)) throw new Error(`${pinned.code}: ${pinned.message}`);
}

async function quote(d: RegistrationDeps): Promise<RegistrationQuote> {
  const res = await d.send({
    request_id: newRequestId(),
    op: {
      kind: "Keyserver",
      cmd: {
        op: "Quote",
        base_url: d.keyserver.url,
        domain: d.keyserver.domain,
        rail: "webcash",
      },
    },
  });
  if (!isOk(res)) throw new Error(`${res.code}: ${res.message}`);
  if (res.body.kind !== "RegistrationQuote") {
    throw new Error(`expected RegistrationQuote, received ${res.body.kind}`);
  }
  return {
    rail: "webcash",
    amount: res.body.amount,
    expires_at_unix: res.body.expires_at_unix,
  };
}

/** The key server's current registration price (pins the anchor; pays nothing). */
export async function quoteRegistrationFee(
  deps: RegistrationDeps = defaultDeps(),
): Promise<RegistrationQuote> {
  await pin(deps);
  return quote(deps);
}

/**
 * Pay the key server's price from the active webcash wallet and register the
 * slot-0 identity. `shownAmount` is the price the user saw: the fee is
 * re-quoted here and, if the key server's price changed since, nothing is
 * paid and the caller must show the new price first.
 */
export async function registerExtroIdentity(
  nickname: string,
  shownAmount: string,
  deps: RegistrationDeps = defaultDeps(),
): Promise<IdentityRegistration> {
  const fingerprint = await deps.selfFingerprint();
  if (isIdentityRegistered(fingerprint)) {
    throw new Error(`identity ${fingerprint} is already registered`);
  }
  const current = await quoteRegistrationFee(deps);
  const feeWats = await deps.parseAmount(current.amount);
  if (feeWats !== (await deps.parseAmount(shownAmount))) {
    throw new PriceChangedError(current);
  }
  const paid = await deps.pay(feeWats);
  if (!paid.ok) throw new Error(paid.error);
  const res = await deps.send({
    request_id: newRequestId(),
    op: {
      kind: "Keyserver",
      cmd: {
        op: "Register",
        base_url: deps.keyserver.url,
        domain: deps.keyserver.domain,
        nickname,
        rail: "webcash",
        bearer_secret: paid.value,
      },
    },
  });
  if (!isOk(res) || res.body.kind !== "IdentityRegistered") {
    // Recover the fee if the keyserver did not redeem it (insert fails
    // harmlessly when it already did).
    await deps.insert(paid.value);
    if (!isOk(res)) throw new Error(`${res.code}: ${res.message}`);
    throw new Error(`expected IdentityRegistered, received ${res.body.kind}`);
  }
  const registered = {
    fingerprint_hex: res.body.fingerprint_hex,
    nickname: res.body.nickname,
    registered_at_unix: res.body.registered_at_unix,
  };
  rememberRegistered(registered);
  return registered;
}

/** The key server's price changed between showing it and paying; nothing was paid. */
export class PriceChangedError extends Error {
  readonly quote: RegistrationQuote;
  constructor(quote: RegistrationQuote) {
    super(
      `The key server's registration fee is now ${quote.amount} webcash; nothing was paid. Review it and register again.`,
    );
    this.name = "PriceChangedError";
    this.quote = quote;
  }
}
