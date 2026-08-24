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
// The Webycash-branded extro-node `pkg/` is rebuilt from the commit pinned in
// wasm-artifacts.json and its byte hashes are verified before every build. The
// loader remains injectable so tests can exercise the boundary independently.

import type { ExtroAdapter } from './client';
import type { ExtroCommand, ExtroResponse } from './commands';
import { DISPATCH_ERR, decodeResponse, encodeCommand, type ExtroCodec } from './codec';
import type { ExtroRuntimeConfig } from './runtime-config';

/**
 * The JS-visible surface extro-node's WASM module exposes (see
 * extro-node/src/wasm/{exports,codec}.rs): the two dispatch entry points plus
 * the two codec helpers this adapter drives. {@link ExtroCodec} is the codec
 * half, so the module satisfies it structurally.
 */
export interface ExtroNodeWasm extends ExtroCodec {
	extro_encode_boot_config(config: ExtroRuntimeConfig): Uint8Array;
	extro_node_boot(config: Uint8Array): Promise<unknown>;
	extro_node_send(msg: Uint8Array): Promise<Uint8Array>;
}

/**
 * A loader is mandatory in application configuration; this fallback exists
 * only to turn an incomplete programmatic construction into a named error.
 */
const defaultLoad = async (): Promise<ExtroNodeWasm> => {
	throw new Error(
		'extro-node WASM artifact is not bundled yet. Pass a `load` function that ' +
			'imports the built extro-node pkg (exposing extro_node_boot / extro_node_send / ' +
			'extro_encode_boot_config / extro_encode_command / extro_decode_response).'
	);
};

export interface BundledNodeOptions {
	/**
	 * Loader for the release-pinned extro-node WASM module.
	 */
	load?: () => Promise<ExtroNodeWasm>;
	/** Validated schema-v1 config. The WASM codec encodes and validates it again. */
	bootConfig: ExtroRuntimeConfig;
}

export class BundledExtroAdapter implements ExtroAdapter {
	readonly mode = 'bundled' as const;
	private wasm: ExtroNodeWasm | null = null;
	private readonly opts: BundledNodeOptions;

	constructor(opts: BundledNodeOptions) {
		this.opts = opts;
	}

	async boot(): Promise<void> {
		if (this.wasm) return;
		const load = this.opts.load ?? defaultLoad;
		this.wasm = await load();
		const bytes = this.wasm.extro_encode_boot_config(this.opts.bootConfig);
		await this.wasm.extro_node_boot(bytes);
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
