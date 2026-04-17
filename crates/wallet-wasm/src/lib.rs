//! Thin WASM bridge for harmoniis-wallet's BrowserWallet.
//!
//! Every function is a direct delegation — zero business logic here.
//! All wallet operations, state management, and crypto live in harmoniis-wallet.

use harmoniis_wallet::browser_wallet::{self, BrowserWallet};
use wasm_bindgen::prelude::*;

fn to_jserr(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

// ── Wallet Lifecycle ────────────────────────────────────────────

#[wasm_bindgen]
pub fn create_wallet(mnemonic_words: Option<String>) -> Result<String, JsError> {
    let wallet = BrowserWallet::create(mnemonic_words.as_deref()).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn get_mnemonic(state_json: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    Ok(wallet.mnemonic().to_string())
}

// ── Key Derivation ──────────────────────────────────────────────

#[wasm_bindgen]
pub fn derive_webcash_secret(state_json: &str, label_index: u32) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.derive_webcash_secret(label_index).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn derive_vault_key(state_json: &str, purpose: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.derive_vault_key(purpose).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn derive_identity(state_json: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.derive_identity_public_key().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn derive_pgp_key(state_json: &str, index: u32) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let (private_hex, public_hex) = wallet.derive_pgp_key(index).map_err(to_jserr)?;
    serde_json::to_string(&serde_json::json!({
        "private_hex": private_hex,
        "public_hex": public_hex
    }))
    .map_err(to_jserr)
}

// ── Webcash HD Derivation (inner, per-output) ───────────────────

#[wasm_bindgen]
pub fn derive_webcash_output_secret(
    master_secret_hex: &str,
    chain_code: u32,
    depth: u64,
) -> Result<String, JsError> {
    browser_wallet::derive_output_secret(master_secret_hex, chain_code, depth).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn secret_to_public_hash(secret: &str) -> String {
    browser_wallet::secret_to_public_hash(secret)
}

// ── Amount Formatting ───────────────────────────────────────────

#[wasm_bindgen]
pub fn format_amount(wats: i64) -> String {
    browser_wallet::format_amount(wats)
}

#[wasm_bindgen]
pub fn parse_amount(s: &str) -> Result<i64, JsError> {
    browser_wallet::parse_amount(s).map_err(to_jserr)
}

// ── Webcash String Parsing ──────────────────────────────────────

#[wasm_bindgen]
pub fn parse_webcash(s: &str) -> Result<JsValue, JsError> {
    let parsed = browser_wallet::parse_webcash(s).map_err(to_jserr)?;
    serde_wasm_bindgen::to_value(&parsed).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn format_webcash(secret: &str, amount_wats: i64) -> String {
    browser_wallet::format_webcash(secret, amount_wats)
}

#[wasm_bindgen]
pub fn format_public_webcash(hash_hex: &str, amount_wats: i64) -> String {
    browser_wallet::format_public_webcash(hash_hex, amount_wats)
}

// ── Balance & State ─────────────────────────────────────────────

#[wasm_bindgen]
pub fn wallet_balance(state_json: &str) -> Result<i64, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.balance().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn wallet_stats(state_json: &str) -> Result<JsValue, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let stats = wallet.stats().map_err(to_jserr)?;
    serde_wasm_bindgen::to_value(&stats).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn master_secret_hex(state_json: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.master_secret_hex().map_err(to_jserr)
}

// ── Payment ─────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn prepare_payment(state_json: &str, amount_wats: i64) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let effect = wallet.prepare_payment(amount_wats).map_err(to_jserr)?;
    serde_json::to_string(&effect).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn apply_payment(state_json: &str, effect_json: &str) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let effect = serde_json::from_str(effect_json).map_err(to_jserr)?;
    wallet.apply_payment(&effect).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

// ── Insert ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn prepare_insert(state_json: &str, webcash_str: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let effect = wallet.prepare_insert(webcash_str).map_err(to_jserr)?;
    serde_json::to_string(&effect).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn apply_insert(state_json: &str, effect_json: &str) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let effect = serde_json::from_str(effect_json).map_err(to_jserr)?;
    wallet.apply_insert(&effect).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

// ── Mining ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn build_mining_params(
    state_json: &str,
    difficulty: u32,
    mining_amount: &str,
) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let params = wallet
        .build_mining_params(difficulty, mining_amount)
        .map_err(to_jserr)?;
    serde_json::to_string(&params).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn store_mined_output(
    state_json: &str,
    secret: &str,
    amount_wats: i64,
) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.store_mined_output(secret, amount_wats).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

// ── Check ───────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn prepare_check(state_json: &str) -> Result<JsValue, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let hashes = wallet.prepare_check().map_err(to_jserr)?;
    serde_wasm_bindgen::to_value(&hashes).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn apply_check(state_json: &str, results_json: &str) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let results: std::collections::HashMap<String, bool> =
        serde_json::from_str(results_json).map_err(to_jserr)?;
    wallet.apply_check(&results).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

// ── Merge ───────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn prepare_merge(state_json: &str, max_outputs: usize) -> Result<JsValue, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let effect = wallet.prepare_merge(max_outputs).map_err(to_jserr)?;
    serde_wasm_bindgen::to_value(&effect).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn apply_merge(state_json: &str, effect_json: &str) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let effect = serde_json::from_str(effect_json).map_err(to_jserr)?;
    wallet.apply_merge(&effect).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

// ── Recovery ────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn prepare_recover_batch(
    state_json: &str,
    chain_name: &str,
    start_depth: u64,
    batch_size: u64,
) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let batch = wallet
        .prepare_recover_batch(chain_name, start_depth, batch_size)
        .map_err(to_jserr)?;
    serde_json::to_string(&batch).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn apply_recover_batch(
    state_json: &str,
    batch_json: &str,
    results_json: &str,
) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let batch = serde_json::from_str(batch_json).map_err(to_jserr)?;
    let results = serde_json::from_str(results_json).map_err(to_jserr)?;
    wallet.apply_recover_batch(&batch, &results).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn set_depth(state_json: &str, chain_name: &str, depth: u64) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.set_depth(chain_name, depth).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

// ── Snapshot ────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn export_snapshot(state_json: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let snap = wallet.export_webcash_snapshot().map_err(to_jserr)?;
    serde_json::to_string_pretty(&snap).map_err(to_jserr)
}

// ── Encryption (delegates to JS — see encryption.ts) ────────────
// Encryption/decryption stays in the JS layer using Web Crypto API.
// This module only handles plaintext wallet state.
