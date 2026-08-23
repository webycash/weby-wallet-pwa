/* tslint:disable */
/* eslint-disable */

export function add_wallet(m: string, family: string, label: string): string;

export function api_url(network: string, endpoint: string): string;

export function check_wallet(s: string, n: string): Promise<string>;

export function create_master_wallet(mnemonic_words?: string | null): string;

export function create_mining_snapshot(): string;

export function create_roaming_wallet(network: string, master_secret_hex: string, webcash_secrets_json: string, depths_json: string): Promise<string>;

export function create_wallet(network: string, mnemonic_words?: string | null): Promise<string>;

export function derive_identity(mnemonic: string): string;

export function derive_pgp_key(mnemonic: string, index: number): string;

export function derive_vault_key(mnemonic: string, purpose: string): string;

export function derive_wallet_secret(m: string, family: string, label: string): string;

/**
 * Full backup: master HarmoniiStore state + all webcash wallet states.
 * `webcash_wallets_json` is a JSON object mapping label -> webylib MemStore JSON.
 */
export function export_full_backup(m: string, webcash_wallets_json: string): string;

export function export_snapshot(s: string, n: string): string;

export function format_amount(wats: bigint): string;

export function format_public_webcash(hash: string, amount: bigint): string;

export function format_webcash(secret: string, amount: bigint): string;

export function gpu_available(): boolean;

export function gpu_init(): Promise<string>;

/**
 * Mine one GPU batch — delegates entirely to harmoniis-wallet.
 */
export function gpu_mine(s: string, n: string): Promise<string>;

export function import_full_backup(backup_json: string): string;

export function init_panic_hook(): void;

export function insert_webcash(s: string, n: string, wc: string): Promise<string>;

export function list_wallets(m: string, family: string): any;

export function master_secret_hex(s: string, n: string): string;

export function merge_outputs(s: string, n: string, max: number): Promise<string>;

export function mining_snapshot_active(snapshot_json: string): boolean;

export function mnemonic_from_hex(hex: string): string;

export function parse_amount(s: string): bigint;

export function parse_webcash(s: string): any;

export function pay_webcash(s: string, n: string, amount_wats: bigint): Promise<string>;

export function record_mining_batch(snapshot_json: string, attempted: bigint, found: boolean, hash_hex: string, difficulty_achieved: number, amount: string): string;

export function recover_wallet(s: string, n: string, gap: number): Promise<string>;

export function remove_wallet(m: string, family: string, label: string): string;

export function rename_wallet(m: string, family: string, old: string, _new: string): string;

/**
 * Scan deterministic webcash slots for active wallets via server recovery.
 */
export function scan_webcash_slots(m: string, network: string, max_slots: number, gap_limit: number): Promise<string>;

export function secret_to_public_hash(secret: string): string;

export function verify_webcash(n: string, wc: string): Promise<string>;

export function wallet_balance(s: string, n: string): bigint;

export function wallet_stats(s: string, n: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly add_wallet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly api_url: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly check_wallet: (a: number, b: number, c: number, d: number) => number;
    readonly create_master_wallet: (a: number, b: number, c: number) => void;
    readonly create_mining_snapshot: (a: number) => void;
    readonly create_roaming_wallet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly create_wallet: (a: number, b: number, c: number, d: number) => number;
    readonly derive_identity: (a: number, b: number, c: number) => void;
    readonly derive_pgp_key: (a: number, b: number, c: number, d: number) => void;
    readonly derive_vault_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_wallet_secret: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly export_full_backup: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly export_snapshot: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly format_amount: (a: number, b: bigint) => void;
    readonly format_public_webcash: (a: number, b: number, c: number, d: bigint) => void;
    readonly format_webcash: (a: number, b: number, c: number, d: bigint) => void;
    readonly gpu_available: () => number;
    readonly gpu_init: () => number;
    readonly gpu_mine: (a: number, b: number, c: number, d: number) => number;
    readonly import_full_backup: (a: number, b: number, c: number) => void;
    readonly init_panic_hook: () => void;
    readonly insert_webcash: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly list_wallets: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly master_secret_hex: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly merge_outputs: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly mining_snapshot_active: (a: number, b: number) => number;
    readonly mnemonic_from_hex: (a: number, b: number, c: number) => void;
    readonly parse_amount: (a: number, b: number, c: number) => void;
    readonly parse_webcash: (a: number, b: number, c: number) => void;
    readonly pay_webcash: (a: number, b: number, c: number, d: number, e: bigint) => number;
    readonly record_mining_batch: (a: number, b: number, c: number, d: bigint, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly recover_wallet: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly remove_wallet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly rename_wallet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly scan_webcash_slots: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly secret_to_public_hash: (a: number, b: number, c: number) => void;
    readonly verify_webcash: (a: number, b: number, c: number, d: number) => number;
    readonly wallet_balance: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wallet_stats: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wasm_bindgen_func_elem_1767: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_1830: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_4049: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_2918: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
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
