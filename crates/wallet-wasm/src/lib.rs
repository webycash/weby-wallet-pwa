//! Thin WASM glue between SvelteKit PWA and webylib/harmoniis-wallet.
//!
//! Chain: PWA (UI) → wallet-wasm (this) → webylib::Wallet
//! All HTTP happens in Rust via webylib::ServerClient.
//! Zero business logic — every function delegates to webylib or harmoniis-wallet.

use wasm_bindgen::prelude::*;

use harmoniis_wallet::keychain::HdKeychain;
use harmoniis_wallet::webylib::server::NetworkMode;
use harmoniis_wallet::webylib::{Amount, SecretWebcash};
use harmoniis_wallet::WebcashWallet as Wallet;

fn to_jserr(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn parse_network(network: &str) -> NetworkMode {
    match network {
        "testnet" => NetworkMode::Testnet,
        _ => NetworkMode::Production,
    }
}

fn open_wallet(state_json: &str, network: &str) -> Result<Wallet, JsError> {
    Wallet::from_json(state_json, parse_network(network)).map_err(to_jserr)
}

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// ── Wallet Lifecycle ────────────────────────────────────────────

/// Create a new wallet. Returns JSON: {state, mnemonic, master_secret}.
/// If mnemonic_words is provided, restores from that mnemonic.
#[wasm_bindgen]
pub async fn create_wallet(network: &str, mnemonic_words: Option<String>) -> Result<String, JsError> {
    let keychain = match mnemonic_words {
        Some(ref words) => HdKeychain::from_mnemonic_words(words).map_err(to_jserr)?,
        None => HdKeychain::generate_new().map_err(to_jserr)?,
    };
    let mode = parse_network(network);
    let wallet = Wallet::new_memory(mode).map_err(to_jserr)?;
    let master_secret = keychain.derive_slot_hex("webcash", 0).map_err(to_jserr)?;
    wallet.store_master_secret(&master_secret).await.map_err(to_jserr)?;
    let state = wallet.to_json().map_err(to_jserr)?;
    let mnemonic = keychain.mnemonic_words();
    serde_json::to_string(&serde_json::json!({
        "state": state,
        "mnemonic": mnemonic,
        "master_secret": master_secret,
    }))
    .map_err(to_jserr)
}

// ── State Queries (sync) ────────────────────────────────────────

#[wasm_bindgen]
pub fn wallet_balance(state_json: &str, network: &str) -> Result<i64, JsError> {
    let wallet = open_wallet(state_json, network)?;
    let store = wallet.export_snapshot().map_err(to_jserr)?;
    let total: i64 = store.unspent_outputs.iter().map(|o| o.amount).sum();
    Ok(total)
}

#[wasm_bindgen]
pub fn wallet_stats(state_json: &str, _network: &str) -> Result<JsValue, JsError> {
    // Parse MemStore JSON directly for efficiency
    let v: serde_json::Value = serde_json::from_str(state_json).map_err(to_jserr)?;
    let outputs = v["outputs"].as_array();
    let (total, unspent, balance) = match outputs {
        Some(arr) => {
            let total = arr.len() as u64;
            let mut unspent_count = 0u64;
            let mut sum = 0i64;
            for o in arr {
                if !o["spent"].as_bool().unwrap_or(true) {
                    unspent_count += 1;
                    sum += o["amount"].as_i64().unwrap_or(0);
                }
            }
            (total, unspent_count, sum)
        }
        None => (0, 0, 0),
    };
    let spent_hashes = v["spent_hashes"].as_array().map(|a| a.len() as u64).unwrap_or(0);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "total_webcash": total,
        "unspent_webcash": unspent,
        "spent_webcash": spent_hashes,
        "total_balance": balance,
    }))
    .map_err(to_jserr)
}

#[wasm_bindgen]
pub fn master_secret_hex(state_json: &str, network: &str) -> Result<String, JsError> {
    let wallet = open_wallet(state_json, network)?;
    wallet.master_secret_hex().map_err(to_jserr)
}

// ── Async Wallet Operations (HTTP in Rust) ──────────────────────

/// Insert webcash: parse, replace on server, store output. Returns new state.
#[wasm_bindgen]
pub async fn insert_webcash(state_json: &str, network: &str, webcash_str: &str) -> Result<String, JsError> {
    let wallet = open_wallet(state_json, network)?;
    let webcash = SecretWebcash::parse(webcash_str).map_err(to_jserr)?;
    wallet.insert(webcash).await.map_err(to_jserr)?;
    wallet.to_json().map_err(to_jserr)
}

/// Pay webcash. Returns JSON: {state, payment_webcash}.
#[wasm_bindgen]
pub async fn pay_webcash(state_json: &str, network: &str, amount_wats: i64) -> Result<String, JsError> {
    let wallet = open_wallet(state_json, network)?;
    let amount = Amount::from_wats(amount_wats);
    let payment_output = wallet.pay(amount, "").await.map_err(to_jserr)?;
    let payment_webcash = harmoniis_wallet::extract_webcash_secret(&payment_output).map_err(to_jserr)?;
    let state = wallet.to_json().map_err(to_jserr)?;
    serde_json::to_string(&serde_json::json!({
        "state": state,
        "payment_webcash": payment_webcash,
    }))
    .map_err(to_jserr)
}

/// Check wallet health. Returns JSON: {state, valid_count, spent_count}.
#[wasm_bindgen]
pub async fn check_wallet(state_json: &str, network: &str) -> Result<String, JsError> {
    let wallet = open_wallet(state_json, network)?;
    let result = wallet.check().await.map_err(to_jserr)?;
    let state = wallet.to_json().map_err(to_jserr)?;
    serde_json::to_string(&serde_json::json!({
        "state": state,
        "valid_count": result.valid_count,
        "spent_count": result.spent_count,
    }))
    .map_err(to_jserr)
}

/// Merge outputs. Returns JSON: {state, merged_count}.
#[wasm_bindgen]
pub async fn merge_outputs(state_json: &str, network: &str, max_outputs: usize) -> Result<String, JsError> {
    let wallet = open_wallet(state_json, network)?;
    let msg = wallet.merge(max_outputs).await.map_err(to_jserr)?;
    let state = wallet.to_json().map_err(to_jserr)?;
    // Extract count from message like "Consolidation completed: 5 outputs merged..."
    let merged_count: usize = msg.split_whitespace()
        .find_map(|w| w.parse().ok())
        .unwrap_or(0);
    serde_json::to_string(&serde_json::json!({
        "state": state,
        "merged_count": merged_count,
        "message": msg,
    }))
    .map_err(to_jserr)
}

/// Recover wallet from master secret. Returns JSON: {state, recovered_count, total_amount}.
#[wasm_bindgen]
pub async fn recover_wallet(state_json: &str, network: &str, gap_limit: usize) -> Result<String, JsError> {
    let wallet = open_wallet(state_json, network)?;
    let result = wallet.recover_from_wallet(gap_limit).await.map_err(to_jserr)?;
    let state = wallet.to_json().map_err(to_jserr)?;
    serde_json::to_string(&serde_json::json!({
        "state": state,
        "recovered_count": result.recovered_count,
        "total_amount": result.total_amount.wats,
    }))
    .map_err(to_jserr)
}

/// Verify a webcash string (health check). Returns JSON: {spent, amount}.
#[wasm_bindgen]
pub async fn verify_webcash(network: &str, webcash_str: &str) -> Result<String, JsError> {
    use harmoniis_wallet::webylib::server::{ServerClient, ServerConfig};

    let wc = SecretWebcash::parse(webcash_str).map_err(to_jserr)?;
    let public = wc.to_public();

    let config = ServerConfig { network: parse_network(network), timeout_seconds: 30 };
    let client = ServerClient::with_config(config).map_err(to_jserr)?;
    let response = client.health_check(std::slice::from_ref(&public)).await.map_err(to_jserr)?;

    let pub_str = public.to_string();
    if let Some(hr) = response.results.get(&pub_str) {
        serde_json::to_string(&serde_json::json!({
            "spent": hr.spent,
            "amount": hr.amount,
        })).map_err(to_jserr)
    } else {
        serde_json::to_string(&serde_json::json!({
            "spent": null,
            "amount": null,
        })).map_err(to_jserr)
    }
}

// ── Snapshot ────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn export_snapshot(state_json: &str, network: &str) -> Result<String, JsError> {
    let wallet = open_wallet(state_json, network)?;
    let snap = wallet.export_snapshot().map_err(to_jserr)?;
    serde_json::to_string_pretty(&snap).map_err(to_jserr)
}

// ── Multi-wallet Management (via WalletCore + MemHarmoniiStore) ─

use harmoniis_wallet::wallet::WalletCore;
use harmoniis_wallet::MemHarmoniiStore;

fn open_core(master_json: &str) -> Result<WalletCore, JsError> {
    let store = MemHarmoniiStore::from_json(master_json).map_err(to_jserr)?;
    Ok(WalletCore::new(Box::new(store)))
}

fn save_core(core: &WalletCore) -> Result<String, JsError> {
    let store = core.store().as_any()
        .downcast_ref::<MemHarmoniiStore>()
        .ok_or_else(|| JsError::new("Not a MemHarmoniiStore"))?;
    store.to_json().map_err(to_jserr)
}

/// Initialize a new master wallet. Returns JSON: {master_state, mnemonic}.
/// master_state = HarmoniiStore JSON (wallet slots, identities, etc.)
#[wasm_bindgen]
pub fn create_master_wallet(mnemonic_words: Option<String>) -> Result<String, JsError> {
    let keychain = match mnemonic_words {
        Some(ref words) => HdKeychain::from_mnemonic_words(words).map_err(to_jserr)?,
        None => HdKeychain::generate_new().map_err(to_jserr)?,
    };
    let mnemonic = keychain.mnemonic_words();

    let store = MemHarmoniiStore::new();
    let core = WalletCore::new(Box::new(store));

    // Store root key material and register all family slots
    core.set_master_keychain_material(&keychain).map_err(to_jserr)?;
    core.set_wallet_label("main").map_err(to_jserr)?;
    core.refresh_slot_registry().map_err(to_jserr)?;

    let master_state = save_core(&core)?;
    serde_json::to_string(&serde_json::json!({
        "master_state": master_state,
        "mnemonic": mnemonic,
    })).map_err(to_jserr)
}

/// List labeled wallets for a family. Returns JSON array of {family, label, slot_index}.
#[wasm_bindgen]
pub fn list_wallets(master_json: &str, family: &str) -> Result<JsValue, JsError> {
    let core = open_core(master_json)?;
    let wallets = core.list_labeled_wallets(family).map_err(to_jserr)?;
    serde_wasm_bindgen::to_value(&wallets).map_err(to_jserr)
}

/// Add a labeled wallet. Returns new master_state.
#[wasm_bindgen]
pub fn add_wallet(master_json: &str, family: &str, label: &str) -> Result<String, JsError> {
    let core = open_core(master_json)?;
    core.derive_secret_for_label(family, label).map_err(to_jserr)?;
    save_core(&core)
}

/// Remove a labeled wallet slot. Returns new master_state.
#[wasm_bindgen]
pub fn remove_wallet(master_json: &str, family: &str, label: &str) -> Result<String, JsError> {
    let core = open_core(master_json)?;
    let slots = core.list_wallet_slots(Some(family)).map_err(to_jserr)?;
    if let Some(slot) = slots.iter().find(|s| s.label.as_deref() == Some(label)) {
        // Delete from store via replace_slot_at with empty descriptor
        let now = chrono::Utc::now().to_rfc3339();
        core.store().replace_slot_at(family, slot.slot_index, label, "", &now).map_err(to_jserr)?;
    }
    save_core(&core)
}

/// Rename a labeled wallet. Returns new master_state.
#[wasm_bindgen]
pub fn rename_wallet(master_json: &str, family: &str, old_label: &str, new_label: &str) -> Result<String, JsError> {
    let core = open_core(master_json)?;
    let slots = core.list_wallet_slots(Some(family)).map_err(to_jserr)?;
    if let Some(slot) = slots.iter().find(|s| s.label.as_deref() == Some(old_label)) {
        let now = chrono::Utc::now().to_rfc3339();
        core.store().replace_slot_at(family, slot.slot_index, new_label, &slot.descriptor, &now).map_err(to_jserr)?;
    } else {
        return Err(JsError::new(&format!("wallet '{}' not found in family '{}'", old_label, family)));
    }
    save_core(&core)
}

/// Get the webcash master secret for a labeled wallet. Used to create webylib::Wallet.
#[wasm_bindgen]
pub fn derive_wallet_secret(master_json: &str, family: &str, label: &str) -> Result<String, JsError> {
    let core = open_core(master_json)?;
    let (secret, _index) = core.derive_secret_for_label(family, label).map_err(to_jserr)?;
    Ok(secret)
}

// ── Key Derivation ─────────────────────────────────────────────

#[wasm_bindgen]
pub fn derive_vault_key(mnemonic: &str, purpose: &str) -> Result<String, JsError> {
    let keychain = HdKeychain::from_mnemonic_words(mnemonic).map_err(to_jserr)?;
    keychain.derive_slot_hex(purpose, 0).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn derive_pgp_key(mnemonic: &str, index: u32) -> Result<String, JsError> {
    let keychain = HdKeychain::from_mnemonic_words(mnemonic).map_err(to_jserr)?;
    let private_hex = keychain.derive_slot_hex("pgp", index).map_err(to_jserr)?;
    // Ed25519: public key from private key
    let private_bytes = hex::decode(&private_hex).map_err(to_jserr)?;
    use sha2::{Sha512, Digest};
    let hash = Sha512::digest(&private_bytes);
    let mut scalar = [0u8; 32];
    scalar.copy_from_slice(&hash[..32]);
    scalar[0] &= 248;
    scalar[31] &= 127;
    scalar[31] |= 64;
    // For now, return private hex; public key derivation needs ed25519-dalek
    serde_json::to_string(&serde_json::json!({
        "private_hex": private_hex,
        "public_hex": hex::encode(scalar),
    }))
    .map_err(to_jserr)
}

#[wasm_bindgen]
pub fn derive_identity(mnemonic: &str) -> Result<String, JsError> {
    let keychain = HdKeychain::from_mnemonic_words(mnemonic).map_err(to_jserr)?;
    keychain.derive_slot_hex("root", 0).map_err(to_jserr)
}

#[wasm_bindgen]
pub fn mnemonic_from_hex(hex_str: &str) -> Result<String, JsError> {
    let keychain = HdKeychain::from_entropy_hex(hex_str).map_err(to_jserr)?;
    Ok(keychain.mnemonic_words())
}

// ── Utility Functions ──────────────────────────────────────────

#[wasm_bindgen]
pub fn api_url(network: &str, endpoint: &str) -> String {
    parse_network(network).endpoint_url(&format!("/api/v1/{endpoint}"))
}

#[wasm_bindgen]
pub fn format_amount(wats: i64) -> String {
    Amount::from_wats(wats).to_string()
}

#[wasm_bindgen]
pub fn parse_amount(s: &str) -> Result<i64, JsError> {
    use std::str::FromStr;
    let amount = Amount::from_str(s).map_err(to_jserr)?;
    Ok(amount.wats)
}

#[wasm_bindgen]
pub fn parse_webcash(s: &str) -> Result<JsValue, JsError> {
    let wc = SecretWebcash::parse(s).map_err(to_jserr)?;
    let secret_str = wc.secret.as_str().map_err(to_jserr)?;
    let hash = hex::encode(sha2::Sha256::digest(secret_str.as_bytes()));
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "amount": wc.amount.wats,
        "secret": secret_str,
        "public_hash": hash,
    }))
    .map_err(to_jserr)
}

use sha2::Digest;

#[wasm_bindgen]
pub fn format_webcash(secret: &str, amount_wats: i64) -> String {
    format!("e{}:secret:{}", Amount::from_wats(amount_wats), secret)
}

#[wasm_bindgen]
pub fn format_public_webcash(hash_hex: &str, amount_wats: i64) -> String {
    format!("e{}:public:{}", Amount::from_wats(amount_wats), hash_hex)
}

#[wasm_bindgen]
pub fn secret_to_public_hash(secret: &str) -> String {
    hex::encode(sha2::Sha256::digest(secret.as_bytes()))
}

// ── GPU Mining (WebGPU via wgpu) ────────────────────────────────

use std::cell::RefCell;
use harmoniis_wallet::miner::gpu::GpuMiner;
use harmoniis_wallet::miner::nonce_table::NonceTable;

thread_local! {
    static GPU_MINER: RefCell<Option<GpuMiner>> = RefCell::new(None);
    static NONCE_TABLE: RefCell<Option<NonceTable>> = RefCell::new(None);
}

#[wasm_bindgen]
pub async fn gpu_init() -> String {
    use harmoniis_wallet::miner::gpu::platform_backend;

    let backend = platform_backend();
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: backend,
        ..Default::default()
    });

    let adapter = match instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
    {
        Ok(a) => a,
        Err(_) => return String::new(),
    };

    match GpuMiner::try_from_adapter(adapter).await {
        Some(m) => {
            let name = m.adapter_name().to_string();
            GPU_MINER.with(|cell| *cell.borrow_mut() = Some(m));
            NONCE_TABLE.with(|cell| {
                if cell.borrow().is_none() {
                    *cell.borrow_mut() = Some(NonceTable::new());
                }
            });
            name
        }
        None => String::new(),
    }
}

#[wasm_bindgen]
pub fn gpu_available() -> bool {
    GPU_MINER.with(|cell| cell.borrow().is_some())
}

/// Mine one GPU batch using harmoniis-wallet WorkUnit. Returns JSON with solution or {found: false}.
#[wasm_bindgen]
pub async fn gpu_mine(
    state_json: &str,
    network: &str,
    difficulty: u32,
    mining_amount: &str,
    subsidy_amount: &str,
) -> Result<String, JsError> {
    use std::str::FromStr;
    use harmoniis_wallet::miner::work_unit::WorkUnit;

    let wallet = open_wallet(state_json, network)?;

    let mining_amt = Amount::from_str(mining_amount).map_err(to_jserr)?;
    let subsidy_amt = Amount::from_str(subsidy_amount).map_err(to_jserr)?;

    // Build work unit via harmoniis-wallet (correct preimage construction)
    let work = WorkUnit::new(difficulty, mining_amt, subsidy_amt);

    // Run GPU mining
    let miner_ref = GPU_MINER.with(|cell| {
        let borrow = cell.borrow();
        let miner = borrow.as_ref().ok_or_else(|| JsError::new("GPU not initialized"))?;
        Ok::<_, JsError>((miner as *const GpuMiner,))
    })?;
    let miner = unsafe { &*miner_ref.0 };

    let chunks = miner
        .mine_batch(&[work.midstate.clone()], difficulty)
        .await
        .map_err(to_jserr)?;

    let chunk = chunks
        .into_iter()
        .next()
        .unwrap_or_else(|| harmoniis_wallet::miner::MiningChunkResult::empty());

    if let Some(mining_result) = chunk.result {
        let nonce_table = NONCE_TABLE.with(|cell| cell.borrow().as_ref().unwrap().clone());
        let full_preimage = work.preimage_string(&nonce_table, mining_result.nonce1_idx, mining_result.nonce2_idx);
        let hash_hex = hex::encode(mining_result.hash);

        // Store the keep secret in wallet
        wallet.store_directly(work.keep_secret).await.map_err(to_jserr)?;
        let new_state = wallet.to_json().map_err(to_jserr)?;

        serde_json::to_string(&serde_json::json!({
            "found": true,
            "state": new_state,
            "preimage_b64": full_preimage,
            "hash_hex": hash_hex,
            "difficulty_achieved": mining_result.difficulty_achieved,
            "attempted": chunk.attempted,
        }))
        .map_err(to_jserr)
    } else {
        let new_state = wallet.to_json().map_err(to_jserr)?;
        serde_json::to_string(&serde_json::json!({
            "found": false,
            "state": new_state,
            "attempted": chunk.attempted,
        }))
        .map_err(to_jserr)
    }
}

/// Submit a mining solution to the server via harmoniis-wallet MiningProtocol.
/// Includes the `work` field (decimal BigUint hash) required by the webcash server.
/// On WASM: sends without Content-Type header to avoid CORS preflight.
#[wasm_bindgen]
pub async fn submit_mining_report(
    network: &str,
    preimage_b64: &str,
    hash_hex: &str,
) -> Result<String, JsError> {
    use harmoniis_wallet::miner::protocol::MiningProtocol;

    let mode = parse_network(network);
    let protocol = MiningProtocol::from_network(&mode).map_err(to_jserr)?;

    let hash_bytes: [u8; 32] = hex::decode(hash_hex)
        .map_err(to_jserr)?
        .try_into()
        .map_err(|_| JsError::new("hash must be 32 bytes"))?;

    let response = protocol.submit_report(preimage_b64, &hash_bytes).await.map_err(to_jserr)?;
    serde_json::to_string(&serde_json::json!({
        "status": response.status,
        "error": response.error,
    }))
    .map_err(to_jserr)
}

/// Get mining target from server via harmoniis-wallet MiningProtocol.
#[wasm_bindgen]
pub async fn get_mining_target(network: &str) -> Result<String, JsError> {
    use harmoniis_wallet::miner::protocol::MiningProtocol;

    let mode = parse_network(network);
    let protocol = MiningProtocol::from_network(&mode).map_err(to_jserr)?;
    let target = protocol.get_target().await.map_err(to_jserr)?;
    serde_json::to_string(&serde_json::json!({
        "difficulty_target_bits": target.difficulty,
        "mining_amount": target.mining_amount.to_string(),
        "mining_subsidy_amount": target.subsidy_amount.to_string(),
    }))
    .map_err(to_jserr)
}
