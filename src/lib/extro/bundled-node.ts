// Same-realm bundled extro-node WASM adapter.
//
// This is the SHIPPING default mode's transport: a Webycash-branded extro-node
// WASM bundle loaded in the same origin as the PWA. Authority is established at
// boot (no CapToken needed for same-realm callers — see
// extro-node/src/scheme402/command.rs `cap_token` docs).
//
// Boot calls `extro_node_boot(config_bytes)`; dispatch calls
// `extro_node_send(rkyv_command_bytes)` and reads the framed
// `[status_byte][rkyv ExtroResponse]` reply. The rkyv command bytes are built —
// and the response bytes parsed — by the extro-node-provided codec exports
// (`extro_encode_command` / `extro_decode_response`, see wasm/codec.rs), so this
// adapter dispatches real typed commands, not a mock.
//
// The only remaining wiring point is the WASM artifact itself: the
// Webycash-branded extro-node `pkg/` is built by `wasm-pack` from the extro-node
// repo and is not vendored into this repo. The embedder supplies it via the
// injectable `load` function (e.g. a dynamic `import()` of the built pkg). Once
// `load` returns the module, encode → send → decode is fully live.

import type { ExtroAdapter } from './client';
import type { ExtroCommand, ExtroResponse } from './commands';
import { DISPATCH_ERR, decodeResponse, encodeCommand, type ExtroCodec } from './codec';

/**
 * The JS-visible surface extro-node's WASM module exposes (see
 * extro-node/src/wasm/{exports,codec}.rs): the two dispatch entry points plus
 * the two codec helpers this adapter drives. {@link ExtroCodec} is the codec
 * half, so the module satisfies it structurally.
 */
export interface ExtroNodeWasm extends ExtroCodec {
	extro_node_boot(config: Uint8Array): Promise<unknown>;
	extro_node_send(msg: Uint8Array): Promise<Uint8Array>;
}

/**
 * Default loader. The Webycash-branded extro-node WASM `pkg/` (built by
 * `wasm-pack build --target web`) is NOT vendored into this repo, so the default
 * loader throws a clear, actionable error: callers wire a real artifact by
 * passing `load` in {@link BundledNodeOptions} (typically a dynamic import of the
 * built pkg, then `await mod.default()` to initialise it). The MOCK adapter
 * remains the tested default.
 */
const defaultLoad = async (): Promise<ExtroNodeWasm> => {
	throw new Error(
		'extro-node WASM artifact is not bundled yet. Pass a `load` function that ' +
			'imports the built extro-node pkg (exposing extro_node_boot / extro_node_send / ' +
			'extro_encode_command / extro_decode_response), or use the mock adapter (default).'
	);
};

export interface BundledNodeOptions {
	/**
	 * Loader for the extro-node WASM module. Injectable so a built artifact can
	 * be wired without changing this file. Defaults to a loader that throws with
	 * guidance (the pkg is not vendored here).
	 */
	load?: () => Promise<ExtroNodeWasm>;
	/** rkyv-encoded boot Config bytes; extro-node currently boots a default. */
	bootConfig?: Uint8Array;
}

export class BundledExtroAdapter implements ExtroAdapter {
	readonly mode = 'bundled' as const;
	private wasm: ExtroNodeWasm | null = null;
	private readonly opts: BundledNodeOptions;

	constructor(opts: BundledNodeOptions = {}) {
		this.opts = opts;
	}

	async boot(): Promise<void> {
		if (this.wasm) return;
		const load = this.opts.load ?? defaultLoad;
		this.wasm = await load();
		await this.wasm.extro_node_boot(this.opts.bootConfig ?? new Uint8Array(0));
	}

	async dispatch(command: ExtroCommand): Promise<ExtroResponse> {
		if (!this.wasm) throw new Error('bundled adapter not booted');
		// Encode (JS object → rkyv bytes) → send → read framed reply → decode
		// (rkyv bytes → JS object), all through the extro-node codec exports.
		const bytes = encodeCommand(this.wasm, command);
		const framed = await this.wasm.extro_node_send(bytes);
		const status = framed[0];
		const body = framed.subarray(1);
		const response = decodeResponse(this.wasm, body);
		if (status === DISPATCH_ERR && response.kind !== 'Err') {
			// Status byte and body disagree — treat as malformed transport.
			return {
				kind: 'Err',
				request_id: command.request_id,
				code: 'Internal',
				message: 'framed status/body mismatch'
			};
		}
		return response;
	}
}
