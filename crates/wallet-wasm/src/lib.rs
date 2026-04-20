//! Thin WASM bindings — every function is a 1-3 line delegation.
//! Business logic lives in harmoniis-wallet and webylib.

use wasm_bindgen::prelude::*;
use harmoniis_wallet::keychain::HdKeychain;
use harmoniis_wallet::wallet::WalletCore;
use harmoniis_wallet::MemHarmoniiStore;
use harmoniis_wallet::webylib::server::NetworkMode;
use harmoniis_wallet::webylib::{Amount, SecretWebcash};
use harmoniis_wallet::WebcashWallet as Wallet;
use harmoniis_wallet::miner::gpu::GpuMiner;
use harmoniis_wallet::miner::nonce_table::NonceTable;
use std::cell::RefCell;
use std::str::FromStr;

fn e(err: impl std::fmt::Display) -> JsError { JsError::new(&err.to_string()) }
fn net(s: &str) -> NetworkMode { if s == "testnet" { NetworkMode::Testnet } else { NetworkMode::Production } }
fn w(s: &str, n: &str) -> Result<Wallet, JsError> { Wallet::from_json(s, net(n)).map_err(e) }
fn core(s: &str) -> Result<WalletCore, JsError> { Ok(WalletCore::new(Box::new(MemHarmoniiStore::from_json(s).map_err(e)?))) }
fn save(c: &WalletCore) -> Result<String, JsError> { c.store().as_any().downcast_ref::<MemHarmoniiStore>().ok_or_else(|| JsError::new("bad store"))?.to_json().map_err(e) }

#[wasm_bindgen(start)]
pub fn init_panic_hook() { console_error_panic_hook::set_once(); }

// ── Webcash wallet (webylib::Wallet) ────────────────────────────

#[wasm_bindgen]
pub async fn create_wallet(network: &str, mnemonic_words: Option<String>) -> Result<String, JsError> {
    let kc = match mnemonic_words { Some(ref w) => HdKeychain::from_mnemonic_words(w), None => HdKeychain::generate_new() }.map_err(e)?;
    let wl = Wallet::new_memory(net(network)).map_err(e)?;
    wl.store_master_secret(&kc.derive_slot_hex("webcash", 0).map_err(e)?).await.map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "mnemonic": kc.mnemonic_words(), "master_secret": kc.derive_slot_hex("webcash",0).map_err(e)?})).map_err(e)?)
}

#[wasm_bindgen]
pub async fn create_roaming_wallet(network: &str, master_secret_hex: &str, webcash_secrets_json: &str, depths_json: &str) -> Result<String, JsError> {
    let wl = Wallet::new_memory(net(network)).map_err(e)?;
    wl.store_master_secret(master_secret_hex).await.map_err(e)?;
    let secrets: Vec<String> = serde_json::from_str(webcash_secrets_json).map_err(e)?;
    for s in &secrets { wl.store_directly(SecretWebcash::parse(s).map_err(e)?).await.map_err(e)?; }
    // Set chain depths by patching the serialised MemStore JSON
    let depths: std::collections::HashMap<String, u64> = serde_json::from_str(depths_json).map_err(e)?;
    if depths.is_empty() { return wl.to_json().map_err(e); }
    let mut state: serde_json::Value = serde_json::from_str(&wl.to_json().map_err(e)?).map_err(e)?;
    if let Some(d) = state.get_mut("depths") {
        for (chain, depth) in &depths { d[chain] = serde_json::json!(depth); }
    }
    Ok(state.to_string())
}

#[wasm_bindgen]
pub fn wallet_balance(s: &str, n: &str) -> Result<i64, JsError> { Ok(w(s,n)?.export_snapshot().map_err(e)?.unspent_outputs.iter().map(|o| o.amount).sum()) }

#[wasm_bindgen]
pub fn wallet_stats(s: &str, n: &str) -> Result<JsValue, JsError> {
    let snap = w(s,n)?.export_snapshot().map_err(e)?;
    let balance: i64 = snap.unspent_outputs.iter().map(|o| o.amount).sum();
    serde_wasm_bindgen::to_value(&serde_json::json!({"total_webcash": snap.unspent_outputs.len() + snap.spent_hashes.len(), "unspent_webcash": snap.unspent_outputs.len(), "spent_webcash": snap.spent_hashes.len(), "total_balance": balance})).map_err(e)
}

#[wasm_bindgen]
pub fn master_secret_hex(s: &str, n: &str) -> Result<String, JsError> { w(s,n)?.master_secret_hex().map_err(e) }

#[wasm_bindgen]
pub async fn insert_webcash(s: &str, n: &str, wc: &str) -> Result<String, JsError> {
    let wl = w(s,n)?; wl.insert(SecretWebcash::parse(wc).map_err(e)?).await.map_err(e)?; wl.to_json().map_err(e)
}

#[wasm_bindgen]
pub async fn pay_webcash(s: &str, n: &str, amount_wats: i64) -> Result<String, JsError> {
    let wl = w(s,n)?; let out = wl.pay(Amount::from_wats(amount_wats), "").await.map_err(e)?;
    let pmt = harmoniis_wallet::extract_webcash_secret(&out).map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "payment_webcash": pmt})).map_err(e)?)
}

#[wasm_bindgen]
pub async fn check_wallet(s: &str, n: &str) -> Result<String, JsError> {
    let wl = w(s,n)?; let r = wl.check().await.map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "valid_count": r.valid_count, "spent_count": r.spent_count})).map_err(e)?)
}

#[wasm_bindgen]
pub async fn merge_outputs(s: &str, n: &str, max: usize) -> Result<String, JsError> {
    let wl = w(s,n)?; let msg = wl.merge(max).await.map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "message": msg})).map_err(e)?)
}

#[wasm_bindgen]
pub async fn recover_wallet(s: &str, n: &str, gap: usize) -> Result<String, JsError> {
    let wl = w(s,n)?; let r = wl.recover_from_wallet(gap).await.map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "recovered_count": r.recovered_count, "total_amount": r.total_amount.wats})).map_err(e)?)
}

#[wasm_bindgen]
pub async fn verify_webcash(n: &str, wc: &str) -> Result<String, JsError> {
    use harmoniis_wallet::webylib::server::{ServerClient, ServerConfig};
    let parsed = SecretWebcash::parse(wc).map_err(e)?; let pub_wc = parsed.to_public();
    let client = ServerClient::with_config(ServerConfig { network: net(n), timeout_seconds: 30 }).map_err(e)?;
    let r = client.health_check(std::slice::from_ref(&pub_wc)).await.map_err(e)?;
    let hr = r.results.values().next();
    Ok(serde_json::to_string(&serde_json::json!({"spent": hr.and_then(|h| h.spent), "amount": hr.and_then(|h| h.amount.clone())})).map_err(e)?)
}

#[wasm_bindgen]
pub fn export_snapshot(s: &str, n: &str) -> Result<String, JsError> { serde_json::to_string_pretty(&w(s,n)?.export_snapshot().map_err(e)?).map_err(e) }

// ── Master wallet (WalletCore + MemHarmoniiStore) ───────────────

/// Scan deterministic webcash slots for active wallets via server recovery.
#[wasm_bindgen]
pub async fn scan_webcash_slots(m: &str, network: &str, max_slots: u32, gap_limit: usize) -> Result<String, JsError> {
    let c = core(m)?;
    let result = c.scan_webcash_slots(net(network), max_slots, gap_limit).await.map_err(e)?;
    let master_updated = save(&c)?;
    Ok(serde_json::to_string(&serde_json::json!({"master_state": master_updated, "wallets": result.wallets, "total_recovered": result.total_recovered})).map_err(e)?)
}

/// Full backup: master HarmoniiStore state + all webcash wallet states.
/// `webcash_wallets_json` is a JSON object mapping label -> webylib MemStore JSON.
#[wasm_bindgen]
pub fn export_full_backup(m: &str, webcash_wallets_json: &str) -> Result<String, JsError> {
    let c = core(m)?;
    let wallets: std::collections::HashMap<String, String> = serde_json::from_str(webcash_wallets_json).map_err(e)?;
    c.export_full_backup(wallets).map_err(e)
}

#[wasm_bindgen]
pub fn import_full_backup(backup_json: &str) -> Result<String, JsError> {
    let (core, wallets) = WalletCore::import_full_backup(backup_json).map_err(e)?;
    let master = save(&core)?;
    Ok(serde_json::to_string(&serde_json::json!({"master_state": master, "webcash_wallets": wallets})).map_err(e)?)
}

#[wasm_bindgen]
pub fn create_master_wallet(mnemonic_words: Option<String>) -> Result<String, JsError> {
    let kc = match mnemonic_words { Some(ref w) => HdKeychain::from_mnemonic_words(w), None => HdKeychain::generate_new() }.map_err(e)?;
    let c = WalletCore::new(Box::new(MemHarmoniiStore::new()));
    c.set_master_keychain_material(&kc).map_err(e)?; c.set_wallet_label("main").map_err(e)?; c.refresh_slot_registry().map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"master_state": save(&c)?, "mnemonic": kc.mnemonic_words()})).map_err(e)?)
}

#[wasm_bindgen]
pub fn list_wallets(m: &str, family: &str) -> Result<JsValue, JsError> { serde_wasm_bindgen::to_value(&core(m)?.list_labeled_wallets(family).map_err(e)?).map_err(e) }

#[wasm_bindgen]
pub fn add_wallet(m: &str, family: &str, label: &str) -> Result<String, JsError> { let c = core(m)?; c.derive_secret_for_label(family, label).map_err(e)?; save(&c) }

#[wasm_bindgen]
pub fn remove_wallet(m: &str, family: &str, label: &str) -> Result<String, JsError> { let c = core(m)?; c.remove_wallet_slot(family, label).map_err(e)?; save(&c) }

#[wasm_bindgen]
pub fn rename_wallet(m: &str, family: &str, old: &str, new: &str) -> Result<String, JsError> { let c = core(m)?; c.rename_wallet_slot(family, old, new).map_err(e)?; save(&c) }

#[wasm_bindgen]
pub fn derive_wallet_secret(m: &str, family: &str, label: &str) -> Result<String, JsError> { Ok(core(m)?.derive_secret_for_label(family, label).map_err(e)?.0) }

// ── Key derivation (harmoniis-wallet keychain) ──────────────────

#[wasm_bindgen]
pub fn derive_vault_key(mnemonic: &str, purpose: &str) -> Result<String, JsError> { HdKeychain::from_mnemonic_words(mnemonic).map_err(e)?.derive_slot_hex(purpose, 0).map_err(e) }

#[wasm_bindgen]
pub fn derive_pgp_key(mnemonic: &str, index: u32) -> Result<String, JsError> {
    let kc = HdKeychain::from_mnemonic_words(mnemonic).map_err(e)?;
    let id = harmoniis_wallet::Identity::from_hex(&kc.derive_slot_hex("pgp", index).map_err(e)?).map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"private_hex": kc.derive_slot_hex("pgp", index).map_err(e)?, "public_hex": id.public_key_hex()})).map_err(e)?)
}

#[wasm_bindgen]
pub fn derive_identity(mnemonic: &str) -> Result<String, JsError> { HdKeychain::from_mnemonic_words(mnemonic).map_err(e)?.derive_slot_hex("root", 0).map_err(e) }

#[wasm_bindgen]
pub fn mnemonic_from_hex(hex: &str) -> Result<String, JsError> { Ok(HdKeychain::from_entropy_hex(hex).map_err(e)?.mnemonic_words()) }

// ── Utilities (webylib types) ───────────────────────────────────

#[wasm_bindgen]
pub fn api_url(network: &str, endpoint: &str) -> String { net(network).endpoint_url(&format!("/api/v1/{endpoint}")) }

#[wasm_bindgen]
pub fn format_amount(wats: i64) -> String { Amount::from_wats(wats).to_string() }

#[wasm_bindgen]
pub fn parse_amount(s: &str) -> Result<i64, JsError> { Ok(Amount::from_str(s).map_err(e)?.wats) }

#[wasm_bindgen]
pub fn parse_webcash(s: &str) -> Result<JsValue, JsError> {
    let wc = SecretWebcash::parse(s).map_err(e)?; let sec = wc.secret.as_str().map_err(e)?;
    serde_wasm_bindgen::to_value(&serde_json::json!({"amount": wc.amount.wats, "secret": sec, "public_hash": hex::encode(sha2::Sha256::digest(sec.as_bytes()))})).map_err(e)
}

use sha2::Digest;

#[wasm_bindgen] pub fn format_webcash(secret: &str, amount: i64) -> String { format!("e{}:secret:{}", Amount::from_wats(amount), secret) }
#[wasm_bindgen] pub fn format_public_webcash(hash: &str, amount: i64) -> String { format!("e{}:public:{}", Amount::from_wats(amount), hash) }
#[wasm_bindgen] pub fn secret_to_public_hash(secret: &str) -> String { hex::encode(sha2::Sha256::digest(secret.as_bytes())) }

// ── GPU Mining (thread_local state + harmoniis-wallet) ──────────

thread_local! {
    static GPU_MINER: RefCell<Option<GpuMiner>> = RefCell::new(None);
    static NONCE_TABLE: RefCell<Option<NonceTable>> = RefCell::new(None);
}

#[wasm_bindgen]
pub async fn gpu_init() -> String {
    let backend = harmoniis_wallet::miner::gpu::platform_backend();
    let inst = harmoniis_wallet::miner::gpu::create_instance(backend);
    let adapter = match inst.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() }).await {
        Ok(a) => a, Err(_) => return String::new(),
    };
    match GpuMiner::try_from_adapter(adapter).await {
        Some(m) => { let name = m.adapter_name().to_string(); GPU_MINER.with(|c| *c.borrow_mut() = Some(m)); NONCE_TABLE.with(|c| { if c.borrow().is_none() { *c.borrow_mut() = Some(NonceTable::new()); } }); name }
        None => String::new(),
    }
}

#[wasm_bindgen]
pub fn gpu_available() -> bool { GPU_MINER.with(|c| c.borrow().is_some()) }

/// Mine one GPU batch. On solution: submit report + insert with HD secret (harmoniis-wallet).
#[wasm_bindgen]
pub async fn gpu_mine(s: &str, n: &str, difficulty: u32, mining_amount: &str, subsidy_amount: &str) -> Result<String, JsError> {
    use harmoniis_wallet::miner::work_unit::WorkUnit;
    use harmoniis_wallet::wallet::webcash::submit_and_claim_mining_solution;
    const BATCH: usize = 8;
    let wl = w(s, n)?;
    let m_amt = Amount::from_str(mining_amount).map_err(e)?;
    let s_amt = Amount::from_str(subsidy_amount).map_err(e)?;
    let works: Vec<WorkUnit> = (0..BATCH).map(|_| WorkUnit::new(difficulty, m_amt, s_amt)).collect();
    let midstates: Vec<_> = works.iter().map(|w| w.midstate.clone()).collect();
    let miner = GPU_MINER.with(|c| { let b = c.borrow(); Ok::<_,JsError>((b.as_ref().ok_or_else(|| JsError::new("GPU not initialized"))? as *const GpuMiner,)) })?;
    let chunks = unsafe { &*miner.0 }.mine_batch(&midstates, difficulty).await.map_err(e)?;
    let total_attempted: u64 = chunks.iter().map(|c| c.attempted).sum();
    for (chunk, work) in chunks.into_iter().zip(works.into_iter()) {
        if let Some(r) = chunk.result {
            let nt = NONCE_TABLE.with(|c| c.borrow().as_ref().unwrap().clone());
            let preimage = work.preimage_string(&nt, r.nonce1_idx, r.nonce2_idx);
            let keep_str = work.keep_secret.to_string();
            submit_and_claim_mining_solution(&wl, &net(n), &preimage, &r.hash, &keep_str).await.map_err(e)?;
            return Ok(serde_json::to_string(&serde_json::json!({"found":true,"state":wl.to_json().map_err(e)?,"preimage_b64":preimage,"hash_hex":hex::encode(r.hash),"difficulty_achieved":r.difficulty_achieved,"attempted":total_attempted})).map_err(e)?);
        }
    }
    Ok(serde_json::to_string(&serde_json::json!({"found":false,"state":wl.to_json().map_err(e)?,"attempted":total_attempted})).map_err(e)?)
}

#[wasm_bindgen]
pub async fn get_mining_target(n: &str) -> Result<String, JsError> {
    use harmoniis_wallet::miner::protocol::MiningProtocol;
    let t = MiningProtocol::from_network(&net(n)).map_err(e)?.get_target().await.map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"difficulty_target_bits":t.difficulty,"mining_amount":t.mining_amount.to_string(),"mining_subsidy_amount":t.subsidy_amount.to_string()})).map_err(e)?)
}
