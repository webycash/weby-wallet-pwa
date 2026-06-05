// Two-real-browser-node fixtures for the e2e exchange harness.
//
// EVERYTHING in here drives the REAL same-realm bundled wasm extro-node that the
// app boots at load (src/routes/+layout.ts → configureExtro({ mode: 'bundled',
// load: loadBundledExtroNode })). There is NO mock anywhere in this path, and
// the {@link assertRealNode} guard FAILS LOUDLY if one ever appears.
//
// How the harness reaches the node:
//   The app exposes the authoritative ExtroClient on `window.__extro` under
//   `import.meta.env.DEV` (the diagnostic hook in +layout.ts). Because there are
//   no DOM test ids on the exchange views, the harness sends REAL ExtroCommands
//   straight through that client from inside the page (page.evaluate) and reads
//   the real typed responses back. This exercises the exact encode→wasm send→
//   decode seam the product uses — not a shim.
//
// A "node" here = one independent BrowserContext (isolated storage/identity) +
// one page that has booted the real wasm node. Node A and Node B never share
// state: separate contexts, separate wasm instances, separate wallets.

import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** The mock fingerprint the MockExtroAdapter returns for DeriveIdentity:
 *  `'fp'.repeat(10)` (see src/lib/extro/mock-node.ts). If a node ever reports
 *  this, a mock is in the path and the run is INVALID. */
export const MOCK_FINGERPRINT_HEX = 'fp'.repeat(10);

/** The mock referee ed25519 pubkey: `'00'.repeat(32)` (see referee-client.ts
 *  MockRefereeClient.pubkey). Same meaning: its presence = mock = invalid. */
export const MOCK_REFEREE_PUBKEY_HEX = '00'.repeat(32);

export interface RealNode {
	readonly name: string;
	readonly context: BrowserContext;
	readonly page: Page;
	/** The distinct test mnemonic this node's real wallet was seeded from. */
	readonly mnemonic: string;
}

// Two DISTINCT valid BIP39 test mnemonics — one per node — so each real wasm
// wallet derives a DIFFERENT identity. These are throwaway test seeds (never
// funded, never persisted); the harness only needs valid, distinct phrases so
// node A's and node B's identities differ by construction.
//
// The extro-node wasm wallet requires 256-bit entropy (24 words) — a 12-word
// (128-bit) phrase is rejected with "mnemonic must encode 256-bit entropy". These
// are the canonical 24-word BIP39 test vectors (Trezor/python-mnemonic), valid by
// checksum and distinct from one another.
export const TEST_MNEMONICS: Record<string, string> = {
	A: 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
	B: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'
};

/**
 * Boot one independent real browser-node. Opens a fresh isolated context, loads
 * the app (which boots the real bundled wasm node via +layout.ts), and waits for
 * `window.__extro` to appear. Throws if it never does — that means the page is
 * not in DEV mode or the bundled adapter never configured (both make the harness
 * meaningless, so we fail rather than silently degrade).
 */
export async function bootRealNode(browser: Browser, name: string): Promise<RealNode> {
	const context = await browser.newContext();
	const page = await context.newPage();

	// Surface page errors/console so a wasm boot panic is visible in the report.
	page.on('pageerror', (err) => console.error(`[node ${name}] pageerror:`, err.message));
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.error(`[node ${name}] console.error:`, msg.text());
	});

	await page.goto('/');

	// The real bundled client is published on window.__extro by the DEV-only hook
	// in +layout.ts. Its absence means we are NOT running the real instrumented
	// app — fail loudly with a clear remediation.
	await page
		.waitForFunction(() => Boolean((window as unknown as { __extro?: unknown }).__extro), undefined, {
			timeout: 60_000
		})
		.catch(() => {
			throw new Error(
				`[node ${name}] window.__extro never appeared. The harness requires the DEV ` +
					`vite-dev server (import.meta.env.DEV true) with PUBLIC_EXTRO_ADAPTER=bundled. ` +
					`Do NOT run against vite preview / a static build, and ensure the wasm artifact ` +
					`in src/lib/node/pkg/ is synced.`
			);
		});

	// SEED the real wasm wallet. The extro-node wasm wallet boots LOCKED with an
	// empty master wallet (see src/lib/extro/seed.ts): DeriveIdentity /
	// DeriveFamilyHandle / Bootstrap all fail with "wallet locked" until an
	// `Import { mnemonic }` command unlocks it. Each node gets a DISTINCT test
	// mnemonic so A and B derive different identities. We dispatch Import through
	// the authoritative `window.__extro` client (NOT by importing seed.ts, which
	// resolves a SEPARATE mock-defaulting singleton — see the +layout.ts note).
	const mnemonic = TEST_MNEMONICS[name] ?? TEST_MNEMONICS.A;
	const seeded = await page.evaluate(async (mnemonicArg) => {
		const client = (window as unknown as { __extro: any }).__extro;
		const { newRequestId } = await import('/src/lib/extro/commands.ts');
		const res = await client.send({
			request_id: newRequestId(),
			op: {
				kind: 'Wallet',
				cmd: {
					op: 'Import',
					mnemonic: mnemonicArg,
					passphrase: new TextEncoder().encode('extro-node-session')
				}
			}
		});
		return res?.kind === 'Ok'
			? { ok: true as const }
			: { ok: false as const, detail: res?.kind === 'Err' ? `${res.code}: ${res.message}` : `unexpected ${res?.kind}/${res?.body?.kind}` };
	}, mnemonic);
	if (!seeded.ok) {
		throw new Error(
			`[node ${name}] failed to seed the real wasm wallet via Import (${seeded.detail}) — ` +
				`DeriveIdentity would report a locked wallet. Check the wasm artifact in src/lib/node/pkg/.`
		);
	}

	return { name, context, page, mnemonic };
}

/** Result of probing a node's real identity. */
export interface NodeIdentity {
	mode: string;
	fingerprintHex: string;
}

/**
 * Probe a node's REAL identity by sending a DeriveIdentity command through the
 * app's own ExtroClient (window.__extro). Returns the adapter mode + the derived
 * fingerprint. Real wasm derives a real fingerprint from the booted wallet; the
 * mock would return the constant {@link MOCK_FINGERPRINT_HEX}.
 */
export async function probeIdentity(node: RealNode, slot = 0): Promise<NodeIdentity> {
	return node.page.evaluate(async (slotArg) => {
		const client = (window as unknown as { __extro: any }).__extro;
		const mode: string = client.mode;
		// Build a real DeriveIdentity command. newRequestId lives in the app's
		// commands module; import it dynamically so we don't depend on a global.
		const { newRequestId } = await import('/src/lib/extro/commands.ts');
		const res = await client.send({
			request_id: newRequestId(),
			op: { kind: 'Wallet', cmd: { op: 'DeriveIdentity', slot: slotArg } }
		});
		const fingerprintHex =
			res?.kind === 'Ok' && res.body?.kind === 'Identity' ? res.body.fingerprint_hex : '<no-identity>';
		return { mode, fingerprintHex };
	}, slot);
}

/**
 * THE NO-MOCK GUARD. Asserts the node is the REAL bundled wasm node and not a
 * mock, on two independent axes:
 *
 *   1. adapter mode is exactly 'bundled' (never 'mock').
 *   2. the derived identity fingerprint is NOT the mock constant — i.e. real
 *      wasm cryptography produced it.
 *
 * Any mock in the path trips one of these and fails the test. Callers run this
 * at the top of every chain step so a regression to mock is caught immediately.
 */
export async function assertRealNode(node: RealNode): Promise<NodeIdentity> {
	const id = await probeIdentity(node);

	expect(
		id.mode,
		`[node ${node.name}] adapter mode must be the real 'bundled' wasm node, got '${id.mode}'. ` +
			`A mock adapter in the path makes this e2e run INVALID.`
	).toBe('bundled');

	expect(
		id.fingerprintHex,
		`[node ${node.name}] identity fingerprint is the MOCK constant — MockExtroAdapter is in ` +
			`the path. This e2e run is INVALID; only the real wasm node may be used.`
	).not.toBe(MOCK_FINGERPRINT_HEX);

	expect(
		id.fingerprintHex,
		`[node ${node.name}] DeriveIdentity returned no real identity ('${id.fingerprintHex}').`
	).toMatch(/^[0-9a-fA-F]{8,}$/);

	return id;
}

/** Tear down a node's browser context. */
export async function closeNode(node: RealNode): Promise<void> {
	await node.context.close();
}
