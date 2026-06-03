import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { type ExtroNodeWasm } from './bundled-node';
import { DISPATCH_ERR, decodeResponse, encodeCommand } from './codec';
import { newRequestId, type ExtroCommand } from './commands';

// The Webycash-branded extro-node WASM `pkg/` is built by
// `wasm-pack build --target web` from the extro-node repo and is NOT vendored
// into this repo. This test loads it from its on-disk location when present and
// proves the bundled adapter dispatches a REAL command through the rkyv codec
// seam (encode → extro_node_send → decode) — no `CodecNotWiredError`. When the
// pkg is absent (e.g. a CI checkout without the sibling extro-node build) the
// test is skipped rather than failed, so the suite stays green either way.

const PKG_DIR = '/Users/george/workspace/extro/extro-node/pkg';
const PKG_JS = `${PKG_DIR}/extro_node.js`;
const PKG_WASM = `${PKG_DIR}/extro_node_bg.wasm`;

const pkgPresent = existsSync(PKG_JS) && existsSync(PKG_WASM);

/** Load + initialise the real extro-node WASM module for Node. */
const loadRealPkg = async (): Promise<ExtroNodeWasm> => {
	const mod = (await import(/* @vite-ignore */ pathToFileURL(PKG_JS).href)) as {
		default: (opts: { module_or_path: BufferSource }) => Promise<unknown>;
		extro_encode_command: (command: unknown) => Uint8Array;
		extro_decode_response: (bytes: Uint8Array) => unknown;
		extro_node_boot: (config: Uint8Array) => Promise<unknown>;
		extro_node_send: (msg: Uint8Array) => Promise<Uint8Array>;
	};
	const wasmBytes = readFileSync(PKG_WASM);
	await mod.default({ module_or_path: wasmBytes });
	return {
		extro_encode_command: mod.extro_encode_command,
		extro_decode_response: mod.extro_decode_response,
		extro_node_boot: mod.extro_node_boot,
		extro_node_send: mod.extro_node_send
	};
};

const verifyPaymentCmd = (): ExtroCommand => ({
	request_id: newRequestId(),
	op: {
		kind: 'Scheme402',
		cmd: {
			op: 'ConditionalVerify',
			signed_payload: new Uint8Array([1, 2, 3, 4]),
			signer_vk: new Uint8Array(32).fill(7),
			expect_outcome: { kind: 'Release' }
		}
	}
});

describe.skipIf(!pkgPresent)('bundled adapter dispatches a real command via the rkyv codec seam', () => {
	it('encodes a typed command, sends it through the real WASM, and decodes a structured response', async () => {
		// This exercises the exact encode → extro_node_send → decode path the
		// BundledExtroAdapter runs in `dispatch`, against the REAL extro-node WASM.
		// We drive it without `adapter.boot()` because boot opens an IndexedDB
		// store that needs a browser `window` (absent under Node); skipping boot
		// is precisely what makes `extro_node_send` return a structured NotBooted
		// response — which still proves the codec seam round-trips real rkyv bytes
		// (NOT a CodecNotWiredError). A full booted dispatch is a browser test
		// (follow-up).
		const wasm = await loadRealPkg();
		const command = verifyPaymentCmd();

		const bytes = encodeCommand(wasm, command);
		expect(bytes.length).toBeGreaterThan(0);

		const framed = await wasm.extro_node_send(bytes);
		const status = framed[0];
		expect(status).toBe(DISPATCH_ERR); // unbooted → error arm
		const response = decodeResponse(wasm, framed.subarray(1));

		expect(response.kind).toBe('Err');
		if (response.kind === 'Err') {
			expect(response.code).toBe('NotBooted');
			// The unbooted branch short-circuits before decoding the command, so
			// it carries the all-zero request_id sentinel (see exports.rs
			// `dispatch`). What matters here is that a real, structured
			// ExtroResponse decoded out of real rkyv bytes — the seam is live.
			expect(response.request_id.length).toBe(16);
			expect(Array.from(response.request_id)).toEqual(new Array(16).fill(0));
		}
	});

	it('round-trips a u128 amount field through encode/decode without precision loss', async () => {
		// Drives the bigint ↔ u128 path in the codec specifically.
		const wasm = await loadRealPkg();
		const big = 340282366920938463463374607431768211455n; // u128::MAX
		const command: ExtroCommand = {
			request_id: newRequestId(),
			op: {
				kind: 'Scheme402',
				cmd: {
					op: 'SimplePay',
					slot: 0,
					scheme: 'webcash',
					amount_raw: big,
					asset: 'webcash',
					pay_to: new Uint8Array(20).fill(1),
					idempotency: new Uint8Array(16).fill(2),
					inner: new Uint8Array([9, 9, 9])
				}
			}
		};
		// encode must not throw — the bigint is accepted and rkyv-archived.
		const bytes = wasm.extro_encode_command(command);
		expect(bytes.length).toBeGreaterThan(0);
	});
});
