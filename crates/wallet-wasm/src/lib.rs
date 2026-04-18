//! Thin WASM bridge for harmoniis-wallet's BrowserWallet.
//!
//! Every function is a direct delegation — zero business logic here.
//! All wallet operations, state management, and crypto live in harmoniis-wallet.

use harmoniis_wallet::browser_wallet::{self, BrowserWallet};
use wasm_bindgen::prelude::*;

fn to_jserr(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Call once to get readable panic messages in the browser console.
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
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

/// Convert 64-char hex entropy to BIP39 mnemonic words.
#[wasm_bindgen]
pub fn mnemonic_from_hex(hex: &str) -> Result<String, JsError> {
    browser_wallet::mnemonic_from_hex(hex).map_err(to_jserr)
}

/// API URL for a given network and endpoint. Single source of truth: webylib.
#[wasm_bindgen]
pub fn api_url(network: &str, endpoint: &str) -> String {
    let mode = match network {
        "testnet" => harmoniis_wallet::webylib::NetworkMode::Testnet,
        _ => harmoniis_wallet::webylib::NetworkMode::Production,
    };
    mode.endpoint_url(&format!("/api/v1/{endpoint}"))
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

// ── Multi-wallet Management ─────────────────────────────────────

#[wasm_bindgen]
pub fn set_active(state_json: &str, family: &str, label: &str) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.set_active(family, label).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn add_wallet(state_json: &str, family: &str, label: &str) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.add_wallet(family, label).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn remove_wallet(state_json: &str, family: &str, label: &str) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet.remove_wallet(family, label).map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn rename_wallet(
    state_json: &str,
    family: &str,
    old_label: &str,
    new_label: &str,
) -> Result<String, JsError> {
    let mut wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    wallet
        .rename_wallet(family, old_label, new_label)
        .map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

#[wasm_bindgen]
pub fn list_wallets(state_json: &str, family: &str) -> Result<JsValue, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let wallets = wallet.list_wallets(family);
    serde_wasm_bindgen::to_value(&wallets).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn active_family(state_json: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    Ok(wallet.active_family().to_string())
}

#[wasm_bindgen]
pub fn active_label(state_json: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    Ok(wallet.active_label().to_string())
}

// ── GPU Mining (WebGPU via wgpu) ────────────────────────────────

use std::cell::RefCell;
use harmoniis_wallet::miner::gpu::GpuMiner;
use wgpu;
use harmoniis_wallet::miner::sha256::Sha256Midstate;
use harmoniis_wallet::miner::nonce_table::NonceTable;
use harmoniis_wallet::miner::NONCE_SPACE_SIZE;

thread_local! {
    static GPU_MINER: RefCell<Option<GpuMiner>> = RefCell::new(None);
    static NONCE_TABLE: RefCell<Option<NonceTable>> = RefCell::new(None);
}

/// Initialize the WebGPU miner. Returns adapter name or empty string if unavailable.
#[wasm_bindgen]
pub async fn gpu_init() -> String {
    use harmoniis_wallet::miner::gpu::platform_backend;

    web_sys::console::log_1(&"GPU: initializing wgpu...".into());

    // Step 1: Create wgpu instance
    let backend = platform_backend();
    web_sys::console::log_1(&format!("GPU: backend = {:?}", backend).into());

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: backend,
        ..Default::default()
    });

    // Step 2: Request adapter
    web_sys::console::log_1(&"GPU: requesting adapter...".into());
    let adapter = match instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }).await {
        Ok(a) => a,
        Err(e) => {
            web_sys::console::error_1(&format!("GPU: request_adapter failed: {e}").into());
            return String::new();
        }
    };

    let info = adapter.get_info();
    web_sys::console::log_1(&format!("GPU: adapter = {} ({:?}, {:?})", info.name, info.backend, info.device_type).into());

    // Step 3: Try to create GpuMiner from this adapter
    match GpuMiner::try_from_adapter(adapter).await {
        Some(m) => {
            let name = m.adapter_name().to_string();
            web_sys::console::log_1(&format!("GPU: miner initialized: {}", name).into());
            GPU_MINER.with(|cell| *cell.borrow_mut() = Some(m));
            NONCE_TABLE.with(|cell| {
                if cell.borrow().is_none() {
                    *cell.borrow_mut() = Some(NonceTable::new());
                }
            });
            name
        }
        None => {
            web_sys::console::error_1(&"GPU: try_from_adapter returned None (device/shader/pipeline init failed)".into());
            String::new()
        }
    }
}

/// Check if GPU miner is initialized.
#[wasm_bindgen]
pub fn gpu_available() -> bool {
    GPU_MINER.with(|cell| cell.borrow().is_some())
}

/// Mine one work unit on GPU. Takes wallet state JSON, returns result JSON.
/// Result: { "found": bool, "preimage_b64": string, "hash_hex": string, "nonce": number }
#[wasm_bindgen]
pub async fn gpu_mine(state_json: &str, difficulty: u32, mining_amount: &str, subsidy_amount: &str) -> Result<String, JsError> {
    let wallet = BrowserWallet::from_json(state_json).map_err(to_jserr)?;
    let work = wallet.build_gpu_mining_work(difficulty, mining_amount, subsidy_amount).map_err(to_jserr)?;

    let midstate = Sha256Midstate::from_prefix(work.prefix_b64.as_bytes());

    let result = GPU_MINER.with(|cell| {
        let borrow = cell.borrow();
        let miner = borrow.as_ref().ok_or_else(|| JsError::new("GPU not initialized"))?;
        // We can't call async from within with(), so clone what we need
        Ok::<_, JsError>((miner as *const GpuMiner, ))
    })?;

    // Safety: single-threaded WASM, GpuMiner lives in thread_local for duration
    let miner_ref = unsafe { &*result.0 };

    let chunks = miner_ref.mine_batch(&[midstate.clone()], difficulty)
        .await
        .map_err(to_jserr)?;

    let chunk = chunks.into_iter().next().unwrap_or_else(|| {
        harmoniis_wallet::miner::MiningChunkResult::empty()
    });

    if let Some(mining_result) = chunk.result {
        let nonce_table = NONCE_TABLE.with(|cell| cell.borrow().as_ref().unwrap().clone());
        let nonce1 = nonce_table.get(mining_result.nonce1_idx);
        let nonce2 = nonce_table.get(mining_result.nonce2_idx);

        // Reconstruct full preimage: prefix_b64 + nonce1(4) + nonce2(4) + "fQ=="
        let mut full_b64 = work.prefix_b64.clone();
        full_b64.push_str(std::str::from_utf8(nonce1).unwrap_or(""));
        full_b64.push_str(std::str::from_utf8(nonce2).unwrap_or(""));
        full_b64.push_str("fQ==");

        let hash_hex = hex::encode(mining_result.hash);
        let nonce = (mining_result.nonce1_idx as u32) * 1000 + (mining_result.nonce2_idx as u32);

        serde_json::to_string(&serde_json::json!({
            "found": true,
            "preimage_b64": full_b64,
            "hash_hex": hash_hex,
            "nonce": nonce,
            "difficulty_achieved": mining_result.difficulty_achieved,
            "secret": work.secret,
            "webcash_str": work.webcash_str,
            "mining_depth": work.mining_depth,
            "attempted": chunk.attempted,
        })).map_err(to_jserr)
    } else {
        serde_json::to_string(&serde_json::json!({
            "found": false,
            "attempted": chunk.attempted,
        })).map_err(to_jserr)
    }
}

// ── Encryption (delegates to JS — see encryption.ts) ────────────
// Encryption/decryption stays in the JS layer using Web Crypto API.
// This module only handles plaintext wallet state.
