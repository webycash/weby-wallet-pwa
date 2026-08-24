/* tslint:disable */
/* eslint-disable */

/**
 * One live 1:1 media call. Built outbound with [`ExtroCall::dial`] or inbound
 * with [`ExtroCall::answer`]; the SDP the module relays to the peer is read
 * from [`offer_sdp`](ExtroCall::offer_sdp) / [`answer_sdp`](ExtroCall::answer_sdp);
 * remote tracks are drained from [`remote_tracks`](ExtroCall::remote_tracks)
 * for `<video>` / `<audio>` attachment.
 */
export class ExtroCall {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Answer an inbound call: apply the caller's `offer_sdp` and answer with
     * `local_media`. Relay [`answer_sdp`](ExtroCall::answer_sdp) back to the
     * caller; remote tracks then surface via
     * [`remote_tracks`](ExtroCall::remote_tracks).
     */
    static answer(offer_sdp: string, local_media: MediaStream): Promise<ExtroCall>;
    /**
     * Complete an outbound call by applying the callee's answer SDP. After
     * this resolves the PeerConnection negotiates and remote tracks begin to
     * arrive.
     */
    apply_answer(answer_sdp: string): Promise<void>;
    /**
     * Tear down the call's PeerConnection (hang up).
     */
    close(): void;
    /**
     * Start an outbound call from `local_media` (a `getUserMedia` /
     * `getDisplayMedia` capture). Relay [`offer_sdp`](ExtroCall::offer_sdp) to
     * the callee, then feed their answer back via
     * [`apply_answer`](ExtroCall::apply_answer).
     */
    static dial(local_media: MediaStream): Promise<ExtroCall>;
    /**
     * Remote media tracks received since the last poll — attach each
     * `MediaStreamTrack` to a `<video>` / `<audio>` element. Drains, so poll
     * it on a timer until the call's tracks have all arrived.
     */
    remote_tracks(): Array<any>;
    /**
     * The local answer SDP to relay back to the caller (inbound calls); empty
     * for an outbound call.
     */
    readonly answer_sdp: string;
    /**
     * The local offer SDP to relay to the callee (outbound calls); empty for
     * an inbound call.
     */
    readonly offer_sdp: string;
}

/**
 * Parse the rkyv `ExtroResponse` bytes (status byte already stripped) into a JS
 * object mirroring `commands.ts::ExtroResponse`.
 */
export function extro_decode_response(bytes: Uint8Array): any;

/**
 * Build the versioned rkyv browser boot payload from a strict JS object.
 * Unknown fields are rejected here instead of being silently ignored.
 */
export function extro_encode_boot_config(config: any): Uint8Array;

/**
 * Build the rkyv `ExtroCommand` bytes for `extro_node_send` from a JS object.
 *
 * The JS shape mirrors `commands.ts::ExtroCommand`. A malformed object yields a
 * rejected `Result` with a descriptive `JsValue` string — the embedder never
 * silently ships garbage bytes.
 */
export function extro_encode_command(command: any): Uint8Array;

export function extro_node_boot(config: Uint8Array): Promise<any>;

/**
 * Dispatch one rkyv-archived [`ExtroCommand`](crate::scheme402::ExtroCommand)
 * to the booted runtime. Returns a `Promise<Uint8Array>` where byte 0 is the
 * status tag and the remainder is the rkyv-archived
 * [`ExtroResponse`](crate::scheme402::ExtroResponse).
 */
export function extro_node_send(msg: Uint8Array): Promise<any>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_extrocall_free: (a: number, b: number) => void;
    readonly extro_decode_response: (a: number, b: number, c: number) => void;
    readonly extro_encode_boot_config: (a: number, b: number) => void;
    readonly extro_encode_command: (a: number, b: number) => void;
    readonly extro_node_boot: (a: number, b: number) => number;
    readonly extro_node_send: (a: number, b: number) => number;
    readonly extrocall_answer: (a: number, b: number, c: number) => number;
    readonly extrocall_answer_sdp: (a: number, b: number) => void;
    readonly extrocall_apply_answer: (a: number, b: number, c: number) => number;
    readonly extrocall_close: (a: number) => void;
    readonly extrocall_dial: (a: number) => number;
    readonly extrocall_offer_sdp: (a: number, b: number) => void;
    readonly extrocall_remote_tracks: (a: number) => number;
    readonly __wasm_bindgen_func_elem_2608: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_2615: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_752: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_752_2: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_752_3: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_752_4: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_752_5: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export4: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export5: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
