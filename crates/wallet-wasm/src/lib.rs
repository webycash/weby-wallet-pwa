//! Thin WASM bindings — every function is a 1-3 line delegation.
//!
//! Webcash (wallet state, rail calls, CPU mining) is webylib, the one webcash
//! wallet core, pinned to the same rev as extro-node. harmoniis-wallet is used
//! only for what it alone owns: the BIP39 HD keychain, the master slot
//! registry/backup, the WebGPU miner and the mining session snapshot.

use wasm_bindgen::prelude::*;
use harmoniis_wallet::keychain::HdKeychain;
use harmoniis_wallet::wallet::WalletCore;
use harmoniis_wallet::MemHarmoniiStore;
use webylib::server::NetworkMode;
use webylib::{Amount, SecretWebcash, Wallet};
use harmoniis_wallet::miner::gpu::GpuMiner;
use harmoniis_wallet::miner::nonce_table::NonceTable;
use harmoniis_wallet::miner::snapshot::MiningSessionSnapshot;
use std::cell::RefCell;
use std::str::FromStr;

fn e(err: impl std::fmt::Display) -> JsError { JsError::new(&err.to_string()) }
/// Resolve the Webcash server. Legacy enums remain for older callers; any
/// `http(s)://` value is treated as `NetworkMode::Custom` so the configured
/// runtime URL (e.g. https://dev.weby.cash/api/webcash) is not remapped to
/// production/testnet hosts inside webylib.
fn net(s: &str) -> Result<NetworkMode, JsError> {
    let trimmed = s.trim().trim_end_matches('/');
    if trimmed == "testnet" {
        Ok(NetworkMode::Testnet)
    } else if trimmed == "production" {
        Ok(NetworkMode::Production)
    } else if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        Ok(NetworkMode::Custom(trimmed.to_string()))
    } else {
        Err(JsError::new(&format!("unsupported_webcash_network:{s}")))
    }
}
/// The same server for harmoniis-wallet's slot scan, which takes its own copy
/// of webylib's `NetworkMode`.
fn harmoniis_net(s: &str) -> Result<harmoniis_wallet::webylib::server::NetworkMode, JsError> {
    use harmoniis_wallet::webylib::server::NetworkMode as H;
    Ok(match net(s)? { NetworkMode::Production => H::Production, NetworkMode::Testnet => H::Testnet, NetworkMode::Custom(u) => H::Custom(u) })
}
fn w(s: &str, n: &str) -> Result<Wallet, JsError> { Wallet::from_json(s, net(n)?).map_err(e) }
fn core(s: &str) -> Result<WalletCore, JsError> { Ok(WalletCore::new(Box::new(MemHarmoniiStore::from_json(s).map_err(e)?))) }
fn save(c: &WalletCore) -> Result<String, JsError> { c.store().as_any().downcast_ref::<MemHarmoniiStore>().ok_or_else(|| JsError::new("bad store"))?.to_json().map_err(e) }

#[wasm_bindgen(start)]
pub fn init_panic_hook() { console_error_panic_hook::set_once(); }

// ── Webcash wallet (webylib::Wallet) ────────────────────────────

#[wasm_bindgen]
pub async fn create_wallet(network: &str, mnemonic_words: Option<String>) -> Result<String, JsError> {
    let kc = match mnemonic_words { Some(ref w) => HdKeychain::from_mnemonic_words(w), None => HdKeychain::generate_new() }.map_err(e)?;
    let wl = Wallet::new_memory(net(network)?).map_err(e)?;
    wl.store_master_secret(&kc.derive_slot_hex("webcash", 0).map_err(e)?).await.map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "mnemonic": kc.mnemonic_words(), "master_secret": kc.derive_slot_hex("webcash",0).map_err(e)?})).map_err(e)?)
}

#[wasm_bindgen]
pub async fn create_roaming_wallet(network: &str, master_secret_hex: &str, webcash_secrets_json: &str, depths_json: &str) -> Result<String, JsError> {
    let wl = Wallet::new_memory(net(network)?).map_err(e)?;
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
pub fn wallet_stats(s: &str, n: &str) -> Result<String, JsError> {
    let wl = w(s,n)?;
    let snap = wl.export_snapshot().map_err(e)?;
    let balance: i64 = snap.unspent_outputs.iter().map(|o| o.amount).sum();
    let depths = &snap.depths;
    Ok(serde_json::to_string(&serde_json::json!({
        "total_webcash": snap.unspent_outputs.len() + snap.spent_hashes.len(),
        "unspent_webcash": snap.unspent_outputs.len(),
        "spent_webcash": snap.spent_hashes.len(),
        "total_balance": balance,
        "mined_count": depths.get("MINING").copied().unwrap_or(0),
        "received_count": depths.get("RECEIVE").copied().unwrap_or(0),
        "sent_count": depths.get("PAY").copied().unwrap_or(0),
    })).map_err(e)?)
}

#[wasm_bindgen]
pub fn master_secret_hex(s: &str, n: &str) -> Result<String, JsError> { w(s,n)?.master_secret_hex().map_err(e) }

#[wasm_bindgen]
pub async fn insert_webcash(s: &str, n: &str, wc: &str) -> Result<String, JsError> {
    let wl = w(s,n)?; wl.insert(SecretWebcash::parse(wc).map_err(e)?).await.map_err(e)?; wl.to_json().map_err(e)
}

#[wasm_bindgen]
pub async fn pay_webcash(s: &str, n: &str, amount_wats: i64) -> Result<String, JsError> {
    let wl = w(s,n)?; let pmt = wl.pay_webcash(Amount::from_wats(amount_wats), "").await.map_err(e)?;
    serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "payment_webcash": pmt.to_string()})).map_err(e)
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
    use webylib::server::{ServerClient, ServerConfig};
    let public = SecretWebcash::parse(wc).map_err(e)?.to_public().to_string();
    let client = ServerClient::with_config(ServerConfig { network: net(n)?, timeout_seconds: 30 }).map_err(e)?;
    let status = client.health_check(std::slice::from_ref(&public)).await.map_err(e)?.pop()
        .ok_or_else(|| JsError::new("health_check returned no status"))?;
    serde_json::to_string(&token_status_json(&status)).map_err(e)
}

/// `{spent, amount}` as the UI reads it; `spent: null` means unknown to the server.
fn token_status_json(status: &webylib::server_client::TokenStatus) -> serde_json::Value {
    use webylib::server_client::TokenStatus;
    match status {
        TokenStatus::Unknown => serde_json::json!({"spent": null, "amount": null}),
        TokenStatus::Unspent { amount } => serde_json::json!({"spent": false, "amount": amount}),
        TokenStatus::Spent { amount } => serde_json::json!({"spent": true, "amount": amount}),
    }
}

#[wasm_bindgen]
pub fn export_snapshot(s: &str, n: &str) -> Result<String, JsError> { serde_json::to_string_pretty(&w(s,n)?.export_snapshot().map_err(e)?).map_err(e) }

// ── Master wallet (WalletCore + MemHarmoniiStore) ───────────────

/// Scan deterministic webcash slots for active wallets via server recovery.
#[wasm_bindgen]
pub async fn scan_webcash_slots(m: &str, network: &str, max_slots: u32, gap_limit: usize) -> Result<String, JsError> {
    // Staged: the slot registry write is private to harmoniis-wallet, so slot
    // scanning still recovers through harmoniis's pinned webylib copy. The
    // resulting states load in webylib (see tests/state_compat.rs).
    let c = core(m)?;
    let result = c.scan_webcash_slots(harmoniis_net(network)?, max_slots, gap_limit).await.map_err(e)?;
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
pub fn api_url(network: &str, endpoint: &str) -> Result<String, JsError> { Ok(net(network)?.endpoint_url(&format!("/api/v1/{endpoint}"))) }

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

/// Mining target, cached for 30 s across batches (one `/target` per window,
/// not per batch).
async fn mining_target(wl: &Wallet) -> Result<webylib::server::TargetResponse, JsError> {
    thread_local! {
        static TARGET: RefCell<Option<(webylib::server::TargetResponse, f64)>> = const { RefCell::new(None) };
    }
    let now = js_sys::Date::now();
    if let Some(t) = TARGET.with(|c| c.borrow().as_ref().filter(|(_, at)| now - at < 30_000.0).map(|(t, _)| t.clone())) {
        return Ok(t);
    }
    let t = wl.server_get_target().await.map_err(e)?;
    TARGET.with(|c| *c.borrow_mut() = Some((t.clone(), now)));
    Ok(t)
}

/// Mine one GPU batch. harmoniis-wallet supplies only the WebGPU nonce search
/// and its work-unit preimage format; target, report and claim are webylib.
/// The claim inserts the random keep secret through `/replace` into the HD
/// RECEIVE chain, so the wallet never holds a non-HD secret.
#[wasm_bindgen]
pub async fn gpu_mine(s: &str, n: &str) -> Result<String, JsError> {
    use harmoniis_wallet::miner::work_unit::WorkUnit;
    const BATCH: usize = 8;
    let wl = w(s, n)?;
    let miner = GPU_MINER.with(|c| { let b = c.borrow(); Ok::<_,JsError>((b.as_ref().ok_or_else(|| JsError::new("GPU not initialized"))? as *const GpuMiner,)) })?;
    let target = mining_target(&wl).await?;
    let difficulty = target.difficulty_target_bits;
    let mining = Amount::from_str(&target.mining_amount).map_err(e)?;
    let subsidy = Amount::from_str(&target.mining_subsidy_amount).map_err(e)?;
    // WorkUnit takes harmoniis's amount type; values cross as wats.
    let works: Vec<WorkUnit> = (0..BATCH)
        .map(|_| WorkUnit::new(difficulty, harmoniis_wallet::webylib::Amount::from_wats(mining.wats), harmoniis_wallet::webylib::Amount::from_wats(subsidy.wats)))
        .collect();
    let midstates: Vec<_> = works.iter().map(|w| w.midstate.clone()).collect();
    let chunks = unsafe { &*miner.0 }.mine_batch(&midstates, difficulty).await.map_err(e)?;
    let attempted: u64 = chunks.iter().map(|c| c.attempted).sum();
    let mut out = serde_json::json!({"found": false, "attempted": attempted, "difficulty": difficulty, "mining_amount": mining.to_string()});
    if let Some((r, work)) = chunks.into_iter().zip(works).find_map(|(c, w)| c.result.map(|r| (r, w))) {
        let preimage = NONCE_TABLE.with(|c| c.borrow().as_ref().map(|t| work.preimage_string(t, r.nonce1_idx, r.nonce2_idx)))
            .ok_or_else(|| JsError::new("nonce table not initialized"))?;
        wl.server_submit_mining_report(&webylib::server::MiningReportRequest { preimage: preimage.clone(), legalese: webylib::server::Legalese { terms: true } })
            .await.map_err(e)?;
        wl.insert(SecretWebcash::parse(&work.keep_secret.to_string()).map_err(e)?).await.map_err(e)?;
        out["found"] = serde_json::json!(true);
        out["preimage_b64"] = serde_json::json!(preimage);
        out["hash_hex"] = serde_json::json!(hex::encode(r.hash));
        out["difficulty_achieved"] = serde_json::json!(r.difficulty_achieved);
    }
    out["state"] = serde_json::json!(wl.to_json().map_err(e)?);
    serde_json::to_string(&out).map_err(e)
}

// ── CPU Mining (WASM, no WebGPU required) ───────────────────────
// webylib's Wallet::mine_batch: HD MINING secrets, depth reserved before the
// report leaves the wallet, mined webcash stored only after the server accepts.

/// Mine one CPU batch of up to `max_attempts` nonces against the configured
/// Webcash server's target; on a solution, report it and store the mined
/// webcash. Returns the same JSON shape as `gpu_mine`.
#[wasm_bindgen]
pub async fn cpu_mine(s: &str, n: &str, max_attempts: u32) -> Result<String, JsError> {
    let wl = w(s, n)?;
    let target = mining_target(&wl).await?;
    let timestamp = (js_sys::Date::now() / 1000.0) as u64;
    let mut start = [0u8; 8];
    getrandom::getrandom(&mut start).map_err(e)?;
    let batch = wl
        .mine_batch(&target, timestamp, u64::from_le_bytes(start) >> 16, u64::from(max_attempts.clamp(1, 1_000_000)))
        .await
        .map_err(e)?;
    let mut out = serde_json::json!({
        "found": batch.result.is_some(), "state": wl.to_json().map_err(e)?, "attempted": batch.attempted,
        "difficulty": batch.difficulty, "mining_amount": batch.mining_amount.to_string(),
    });
    if let Some(r) = &batch.result {
        let hash = hex::decode(&r.hash).map_err(e)?;
        out["hash_hex"] = serde_json::json!(r.hash);
        out["difficulty_achieved"] = serde_json::json!(webylib::miner::leading_zero_bits(&hash));
    }
    serde_json::to_string(&out).map_err(e)
}

// ── Mining session snapshot ─────────────────────────────────────

#[wasm_bindgen]
pub fn create_mining_snapshot() -> String {
    serde_json::to_string(&MiningSessionSnapshot::new()).unwrap()
}

#[wasm_bindgen]
pub fn record_mining_batch(
    snapshot_json: &str, attempted: u64, found: bool,
    hash_hex: &str, difficulty_achieved: u32, amount: &str,
) -> Result<String, JsError> {
    let mut snap = MiningSessionSnapshot::from_json(snapshot_json).map_err(e)?;
    snap.record_batch(attempted, found, hash_hex, difficulty_achieved, amount);
    snap.to_json().map_err(e)
}

#[wasm_bindgen]
pub fn mining_snapshot_active(snapshot_json: &str) -> bool {
    MiningSessionSnapshot::from_json(snapshot_json).map(|s| s.is_active()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;
    use webylib::server_client::TokenStatus;

    /// Test fixture only (all 0x11), never a user secret.
    const MASTER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const NET: &str = "https://webcash.invalid";

    #[wasm_bindgen_test]
    fn token_status_maps_to_the_ui_shape() {
        assert_eq!(token_status_json(&TokenStatus::Unknown), serde_json::json!({"spent": null, "amount": null}));
        assert_eq!(token_status_json(&TokenStatus::Unspent { amount: Some("1.5".into()) }), serde_json::json!({"spent": false, "amount": "1.5"}));
        assert_eq!(token_status_json(&TokenStatus::Spent { amount: Some("2".into()) }), serde_json::json!({"spent": true, "amount": "2"}));
    }

    #[wasm_bindgen_test]
    fn harmoniis_network_is_the_same_server() {
        use harmoniis_wallet::webylib::server::NetworkMode as H;
        assert!(matches!(harmoniis_net("production"), Ok(H::Production)));
        assert!(matches!(harmoniis_net("testnet"), Ok(H::Testnet)));
        assert!(matches!(harmoniis_net("https://dev.weby.cash/api/webcash/"), Ok(H::Custom(u)) if u == "https://dev.weby.cash/api/webcash"));
        assert!(harmoniis_net("mainnet").is_err());
    }

    /// Slot scan still recovers through harmoniis's webylib copy; its wallet
    /// state must load unchanged in webylib, the wallet core.
    #[wasm_bindgen_test]
    async fn harmoniis_slot_state_loads_in_webylib() {
        use harmoniis_wallet::webylib as old;
        let net_old = harmoniis_net(NET).unwrap();
        let legacy = old::Wallet::new_memory(net_old).unwrap();
        legacy.store_master_secret(MASTER).await.unwrap();
        legacy.store_directly(old::SecretWebcash::parse(&format!("e1.25:secret:{}", "22".repeat(32))).unwrap()).await.unwrap();
        let before = legacy.export_snapshot().unwrap();

        let state = legacy.to_json().unwrap();
        let after = w(&state, NET).map_err(|_| "load").unwrap().export_snapshot().unwrap();
        assert!(after.master_secret == before.master_secret, "master secret changed across cores");
        assert_eq!(after.depths, before.depths);
        let pairs = |v: Vec<(String, i64)>| { let mut v = v; v.sort(); v };
        assert_eq!(
            pairs(after.unspent_outputs.iter().map(|o| (o.secret.clone(), o.amount)).collect()),
            pairs(before.unspent_outputs.iter().map(|o| (o.secret.clone(), o.amount)).collect()),
        );
        assert_eq!(wallet_balance(&state, NET).map_err(|_| "balance").unwrap(), 125_000_000);
    }

    #[wasm_bindgen_test]
    async fn new_wallet_state_is_webylib_and_round_trips() {
        let created: serde_json::Value = serde_json::from_str(&create_wallet(NET, None).await.map_err(|_| "create").unwrap()).unwrap();
        let state = created["state"].as_str().unwrap();
        let wl = w(state, NET).map_err(|_| "load").unwrap();
        let as_value = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        assert!(as_value(&wl.to_json().unwrap()) == as_value(state), "state changed on round trip");
        assert!(net("ftp://x").is_err());
    }
}
