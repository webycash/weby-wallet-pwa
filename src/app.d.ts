/// <reference types="@sveltejs/kit" />

declare namespace App {}

// Vite alias for compiled WASM package — types from wallet-wasm exports
declare module '$wasm/wallet_wasm' {
	const init: () => Promise<any>;
	export default init;

	// Master wallet (HarmoniiStore — multi-wallet, identities, key material)
	export function scan_webcash_slots(master_json: string, network: string, max_slots: number, gap_limit: number): Promise<string>;
	export function export_full_backup(master_json: string, webcash_wallets_json: string): string;
	export function import_full_backup(backup_json: string): string;
	export function create_master_wallet(mnemonic_words?: string): string;
	export function list_wallets(master_json: string, family: string): any[];
	export function add_wallet(master_json: string, family: string, label: string): string;
	export function remove_wallet(master_json: string, family: string, label: string): string;
	export function rename_wallet(master_json: string, family: string, old_label: string, new_label: string): string;
	export function derive_wallet_secret(master_json: string, family: string, label: string): string;

	// Per-wallet lifecycle (webylib::Wallet — webcash operations)
	export function create_wallet(network: string, mnemonic_words?: string): Promise<string>;
	export function create_roaming_wallet(network: string, master_secret_hex: string, webcash_secrets_json: string, depths_json: string): Promise<string>;

	// State queries
	export function wallet_balance(state_json: string, network: string): bigint;
	export function wallet_stats(state_json: string, network: string): any;
	export function master_secret_hex(state_json: string, network: string): string;
	export function export_snapshot(state_json: string, network: string): string;

	// Async operations (HTTP in Rust)
	export function insert_webcash(state_json: string, network: string, webcash_str: string): Promise<string>;
	export function pay_webcash(state_json: string, network: string, amount_wats: bigint): Promise<string>;
	export function check_wallet(state_json: string, network: string): Promise<string>;
	export function merge_outputs(state_json: string, network: string, max_outputs: number): Promise<string>;
	export function recover_wallet(state_json: string, network: string, gap_limit: number): Promise<string>;
	export function verify_webcash(network: string, webcash_str: string): Promise<string>;

	// Key derivation
	export function derive_vault_key(mnemonic: string, purpose: string): string;
	export function derive_pgp_key(mnemonic: string, index: number): string;
	export function derive_identity(mnemonic: string): string;
	export function mnemonic_from_hex(hex: string): string;

	// Utilities
	export function api_url(network: string, endpoint: string): string;
	export function format_amount(wats: bigint): string;
	export function parse_amount(s: string): bigint;
	export function parse_webcash(s: string): any;
	export function format_webcash(secret: string, amount_wats: bigint): string;
	export function format_public_webcash(hash_hex: string, amount_wats: bigint): string;
	export function secret_to_public_hash(secret: string): string;

	// GPU mining
	export function gpu_init(): Promise<string>;
	export function gpu_available(): boolean;
	export function gpu_mine(state_json: string, network: string): Promise<string>;
}
