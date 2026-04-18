/// <reference types="@sveltejs/kit" />

declare namespace App {}

// Vite alias for compiled WASM package — types come from wasm-pack generated .d.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module '$wasm/wallet_wasm' {
	const init: () => Promise<any>;
	export default init;
	export function create_wallet(mnemonic_words?: string): string;
	export function get_mnemonic(state_json: string): string;
	export function master_secret_hex(state_json: string): string;
	export function mnemonic_from_hex(hex: string): string;
	export function wallet_balance(state_json: string): bigint;
	export function wallet_stats(state_json: string): any;
	export function format_amount(wats: bigint): string;
	export function parse_amount(s: string): bigint;
	export function format_webcash(secret: string, amount_wats: bigint): string;
	export function format_public_webcash(hash_hex: string, amount_wats: bigint): string;
	export function parse_webcash(s: string): any;
	export function secret_to_public_hash(secret: string): string;
	export function derive_webcash_output_secret(master_secret_hex: string, chain_code: number, depth: bigint): string;
	export function prepare_payment(state_json: string, amount_wats: bigint): string;
	export function apply_payment(state_json: string, effect_json: string): string;
	export function prepare_insert(state_json: string, webcash_str: string): string;
	export function apply_insert(state_json: string, effect_json: string): string;
	export function prepare_check(state_json: string): string[];
	export function apply_check(state_json: string, results_json: string): string;
	export function prepare_merge(state_json: string, max_outputs: number): any;
	export function apply_merge(state_json: string, effect_json: string): string;
	export function prepare_recover_batch(state_json: string, chain_name: string, start_depth: bigint, batch_size: bigint): string;
	export function apply_recover_batch(state_json: string, batch_json: string, results_json: string): string;
	export function set_depth(state_json: string, chain_name: string, depth: bigint): string;
	export function build_mining_params(state_json: string, difficulty: number, mining_amount: string): string;
	export function store_mined_output(state_json: string, secret: string, amount_wats: bigint): string;
	export function export_snapshot(state_json: string): string;
	export function set_active(state_json: string, family: string, label: string): string;
	export function add_wallet(state_json: string, family: string, label: string): string;
	export function remove_wallet(state_json: string, family: string, label: string): string;
	export function rename_wallet(state_json: string, family: string, old_label: string, new_label: string): string;
	export function list_wallets(state_json: string, family: string): any;
	export function active_family(state_json: string): string;
	export function active_label(state_json: string): string;
	export function api_url(network: string, endpoint: string): string;
	export function gpu_init(): Promise<string>;
	export function gpu_available(): boolean;
	export function gpu_mine(state_json: string, difficulty: number, mining_amount: string): Promise<string>;
}
