// Same-realm bundled extro-node WASM adapter.
//
// This is the SHIPPING default mode's transport: a Webycash-branded extro-node
// WASM bundle loaded in the same origin as the PWA. Authority is established at
// boot (no CapToken needed for same-realm callers — see
// extro-node/src/scheme402/command.rs `cap_token` docs).
//
// Boot calls `extro_node_boot(config_bytes)`; dispatch calls
// `extro_node_send(rkyv_command_bytes)` and reads the framed
// `[status_byte][rkyv ExtroResponse]` reply.
//
// DEFERRED: the actual extro-node WASM artifact is not bundled into this repo
// yet, and the rkyv command encoder/decoder ({@link ./codec}) is a stub. Until
// those land, constructing this adapter is fine, but `dispatch` will surface a
// clear `CodecNotWiredError`. The MOCK adapter is the tested default. This file
// exists so the same-realm shape is in place and only the codec + the WASM
// import need wiring later.

import type { ExtroAdapter } from './client';
import type { ExtroCommand, ExtroResponse } from './commands';
import { DISPATCH_ERR, decodeResponse, encodeCommand } from './codec';

/** The two JS-visible exports extro-node exposes (see wasm/exports.rs). */
interface ExtroNodeWasm {
	extro_node_boot(config: Uint8Array): Promise<unknown>;
	extro_node_send(msg: Uint8Array): Promise<Uint8Array>;
}

/**
 * Default loader. The Webycash-branded extro-node WASM artifact is NOT bundled
 * into this repo yet (the only WASM pkg present is the legacy `wallet-wasm`
 * harmoniis wrapper, which lacks `extro_node_boot`/`extro_node_send`). Until the
 * artifact is added to the build, this throws a clear error; callers wire a
 * real artifact by passing `load` in {@link BundledNodeOptions}. The MOCK
 * adapter remains the tested default.
 */
const defaultLoad = async (): Promise<ExtroNodeWasm> => {
	throw new Error(
		'extro-node WASM artifact is not bundled yet. Pass a `load` function that ' +
			'imports the built extro-node pkg (exposing extro_node_boot / extro_node_send), ' +
			'or use the mock adapter (default).'
	);
};

export interface BundledNodeOptions {
	/**
	 * Loader for the extro-node WASM module. Injectable so a built artifact can
	 * be wired without changing this file. Defaults to a dynamic import of the
	 * (not-yet-present) bundled package.
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
		// Encode → send → read framed reply. `encodeCommand`/`decodeResponse` are
		// the deferred rkyv seam; they throw a clear error until wired.
		const bytes = encodeCommand(command);
		const framed = await this.wasm.extro_node_send(bytes);
		const status = framed[0];
		const body = framed.subarray(1);
		const response = decodeResponse(body);
		if (status === DISPATCH_ERR && response.kind !== 'Err') {
			// Status byte and body disagree — treat as malformed transport.
			return { kind: 'Err', request_id: command.request_id, code: 'Internal', message: 'framed status/body mismatch' };
		}
		return response;
	}
}
