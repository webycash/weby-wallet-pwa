// rkyv codec seam for the bundled extro-node adapter.
//
// extro-node's `extro_node_send` consumes rkyv-archived `ExtroCommand` bytes and
// returns `[status_byte][rkyv ExtroResponse]` (see
// extro-node/src/wasm/exports.rs). The rkyv archived layout is version-pinned to
// the extro-node build, so the bytes are NOT hand-rolled in TypeScript — they
// are produced/parsed by the thin extrolib-provided WASM helpers extro-node now
// exports alongside the dispatch entry point (see extro-node/src/wasm/codec.rs):
//
//   * `extro_encode_command(jsObject) -> Uint8Array`  — JS object → rkyv bytes
//   * `extro_decode_response(Uint8Array) -> jsObject`  — rkyv bytes → JS object
//
// Both bridge the exact tagged-union shapes declared in {@link ./commands}
// (`Op` = `{kind, cmd}`; command variants = `{op, ...}`;
// `ExpectedOutcome`/`PushKind`/`ResponseBody` = `{kind, ...}`; `u128` ↔ bigint;
// `[u8;N]`/`Vec<u8>` ↔ `Uint8Array`). The exchange module never touches raw
// bytes — it speaks the typed structures and this seam does the rkyv step.

import type { ExtroCommand, ExtroResponse } from './commands';

/** The two codec exports extro-node provides (see wasm/codec.rs). */
export interface ExtroCodec {
	/** JS `ExtroCommand` object → rkyv-archived command bytes. */
	extro_encode_command(command: unknown): Uint8Array;
	/** rkyv-archived response bytes (status byte stripped) → JS `ExtroResponse`. */
	extro_decode_response(bytes: Uint8Array): unknown;
}

/**
 * Encode a typed {@link ExtroCommand} to the rkyv bytes `extro_node_send`
 * expects, via the loaded extro-node WASM codec. The object is passed through
 * verbatim — its field names/casing already match the Rust command surface
 * (see {@link ./commands}).
 */
export function encodeCommand(codec: ExtroCodec, command: ExtroCommand): Uint8Array {
	return codec.extro_encode_command(command);
}

/**
 * Decode the rkyv `ExtroResponse` bytes (after the status byte is stripped) into
 * a typed {@link ExtroResponse}, via the loaded extro-node WASM codec.
 */
export function decodeResponse(codec: ExtroCodec, bytes: Uint8Array): ExtroResponse {
	return codec.extro_decode_response(bytes) as ExtroResponse;
}

/** Status byte semantics from the framed `extro_node_send` reply. */
export const DISPATCH_OK = 0x00;
export const DISPATCH_ERR = 0x01;
