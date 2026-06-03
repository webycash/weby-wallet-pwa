// rkyv codec seam for the bundled extro-node adapter.
//
// extro-node's `extro_node_send` consumes rkyv-archived `ExtroCommand` bytes and
// returns `[status_byte][rkyv ExtroResponse]` (see
// extro-node/src/wasm/exports.rs). Producing/parsing those bytes from
// TypeScript is a genuine integration task: rkyv's archived layout is
// version-pinned to the extro-node build and there is no published TS encoder
// yet. The exchange module must NOT hand-roll a generic Extro wire codec (that
// is an extrolib/extro-node concern, per the architecture boundary).
//
// Therefore this seam is intentionally a STUB: the mock adapter is the tested
// default, and wiring a real rkyv encoder/decoder (or a thin extrolib-provided
// WASM helper) is a DEFERRED item tracked in the deliverables. When that helper
// lands, only this file changes — the facade and the whole exchange module
// already speak the typed {@link ExtroCommand}/{@link ExtroResponse} shapes.

import type { ExtroCommand, ExtroResponse } from './commands';

export class CodecNotWiredError extends Error {
	constructor(direction: 'encode' | 'decode') {
		super(
			`extro-node rkyv ${direction} is not wired yet. Use the mock adapter ` +
				`(default) for dev/tests; the bundled adapter needs the extrolib rkyv ` +
				`helper for ExtroCommand/ExtroResponse before it can dispatch.`
		);
		this.name = 'CodecNotWiredError';
	}
}

/** Encode a typed {@link ExtroCommand} to the rkyv bytes `extro_node_send` expects. */
export function encodeCommand(_command: ExtroCommand): Uint8Array {
	throw new CodecNotWiredError('encode');
}

/** Decode the rkyv `ExtroResponse` bytes (after the status byte is stripped). */
export function decodeResponse(_bytes: Uint8Array): ExtroResponse {
	throw new CodecNotWiredError('decode');
}

/** Status byte semantics from the framed `extro_node_send` reply. */
export const DISPATCH_OK = 0x00;
export const DISPATCH_ERR = 0x01;
