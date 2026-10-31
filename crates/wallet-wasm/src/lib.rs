//! Thin WASM bindings — every function is a 1-3 line delegation.
//!
//! Webcash (wallet state, rail calls, CPU mining, slot scan) is webylib, the
//! one webcash wallet core. The HD root, master slot registry and WebGPU miner
//! are extro-node (`wallet::{hd_root, slot_registry}`, `mining::{backend::gpu,
//! kernel}`), linked at the same webylib rev. This crate owns only the JS/JSON
//! surface (`master_state`).

mod master_state;

use extro_node::mining::backend::gpu::GpuMiner;
use extro_node::mining::kernel::nonce_table::NonceTable;
use extro_node::mining::kernel::work_unit::WorkUnit;
use extro_node::wallet::hd_root::{HdRoot, SlotFamily};
use extro_node::wallet::slot_registry::SlotRegistry;
use master_state::{FullBackup, LabeledWalletJson, MasterState};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::str::FromStr;
use wasm_bindgen::prelude::*;
use webylib::server::NetworkMode;
use webylib::{Amount, SecretWebcash, Wallet};

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
fn w(s: &str, n: &str) -> Result<Wallet, JsError> { Wallet::from_json(s, net(n)?).map_err(e) }
fn master(m: &str) -> Result<MasterState, JsError> { MasterState::from_json(m).map_err(|m| JsError::new(&m)) }
fn save(m: MasterState) -> Result<String, JsError> { m.to_json().map_err(|m| JsError::new(&m)) }
/// Registry timestamp: RFC 3339, millisecond precision (the legacy format).
fn now() -> String { chrono::DateTime::from_timestamp_millis(js_sys::Date::now() as i64).unwrap_or_default().to_rfc3339() }
/// A fresh 256-bit root, or the user's phrase.
fn hd_root(mnemonic_words: Option<&str>) -> Result<HdRoot, JsError> {
    match mnemonic_words {
        Some(words) => HdRoot::from_mnemonic_words(words).map_err(e),
        None => {
            let mut entropy = zeroize::Zeroizing::new([0u8; 32]);
            getrandom::getrandom(entropy.as_mut_slice()).map_err(e)?;
            HdRoot::from_entropy(entropy.as_slice()).map_err(e)
        }
    }
}
fn family(s: &str) -> Result<SlotFamily, JsError> { SlotFamily::parse(s).map_err(e) }

#[wasm_bindgen(start)]
pub fn init_panic_hook() { console_error_panic_hook::set_once(); }

// ── Webcash wallet (webylib::Wallet) ────────────────────────────

#[wasm_bindgen]
pub async fn create_wallet(network: &str, mnemonic_words: Option<String>) -> Result<String, JsError> {
    let root = hd_root(mnemonic_words.as_deref())?;
    let secret = root.derive_slot_hex(SlotFamily::Webcash, 0).map_err(e)?;
    let wl = Wallet::new_memory(net(network)?).map_err(e)?;
    wl.store_master_secret(&secret).await.map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"state": wl.to_json().map_err(e)?, "mnemonic": root.mnemonic_words().map_err(e)?.as_str(), "master_secret": secret.as_str()})).map_err(e)?)
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

// ── Master wallet (extro-node SlotRegistry, legacy JSON) ────────

/// Scan deterministic webcash slots for active wallets (webylib
/// `scan_slots`); active slots beyond `main` are registered under their
/// existing label. Any server or registry failure fails the whole scan.
#[wasm_bindgen]
pub async fn scan_webcash_slots(m: &str, network: &str, max_slots: u32, gap_limit: usize) -> Result<String, JsError> {
    let mut state = master(m)?;
    let candidates: Vec<_> = state.registry.webcash_scan_candidates(max_slots).map_err(e)?.into_iter()
        .map(|c| webylib::wallet::SlotCandidate { index: c.slot_index, label: c.label, master_secret_hex: c.master_secret_hex })
        .collect();
    let active = webylib::wallet::scan_slots(net(network)?, &candidates, gap_limit).await.map_err(e)?;
    let (at, mut wallets, mut total_recovered) = (now(), BTreeMap::new(), 0usize);
    for slot in &active {
        if slot.index > 0 { state.registry.register_slot("webcash", slot.index, &slot.label, &at).map_err(e)?; }
        total_recovered += slot.recovered_count;
        wallets.insert(slot.label.as_str(), slot.state_json.as_str());
    }
    Ok(serde_json::to_string(&serde_json::json!({"master_state": save(state)?, "wallets": wallets, "total_recovered": total_recovered})).map_err(e)?)
}

/// Full backup: master state + all webcash wallet states.
/// `webcash_wallets_json` is a JSON object mapping label -> webylib MemStore JSON.
#[wasm_bindgen]
pub fn export_full_backup(m: &str, webcash_wallets_json: &str) -> Result<String, JsError> {
    let wallets: BTreeMap<String, String> = serde_json::from_str(webcash_wallets_json).map_err(e)?;
    FullBackup::export(master(m)?, wallets, now()).map_err(|m| JsError::new(&m))
}

#[wasm_bindgen]
pub fn import_full_backup(backup_json: &str) -> Result<String, JsError> {
    let (state, wallets) = FullBackup::import(backup_json).map_err(|m| JsError::new(&m))?;
    Ok(serde_json::to_string(&serde_json::json!({"master_state": save(state)?, "webcash_wallets": wallets})).map_err(e)?)
}

#[wasm_bindgen]
pub fn create_master_wallet(mnemonic_words: Option<String>) -> Result<String, JsError> {
    let root = hd_root(mnemonic_words.as_deref())?;
    let state = MasterState::new(SlotRegistry::create_master(&root, &now()).map_err(e)?);
    Ok(serde_json::to_string(&serde_json::json!({"master_state": save(state)?, "mnemonic": root.mnemonic_words().map_err(e)?.as_str()})).map_err(e)?)
}

#[wasm_bindgen]
pub fn list_wallets(m: &str, family: &str) -> Result<JsValue, JsError> {
    let rows = master(m)?.registry.list_labeled(family);
    let json: Vec<LabeledWalletJson> = rows.iter().map(Into::into).collect();
    serde_wasm_bindgen::to_value(&json).map_err(e)
}

#[wasm_bindgen]
pub fn add_wallet(m: &str, family: &str, label: &str) -> Result<String, JsError> {
    let mut state = master(m)?; state.registry.derive_secret_for_label(family, label, &now()).map_err(e)?; save(state)
}

#[wasm_bindgen]
pub fn remove_wallet(m: &str, family: &str, label: &str) -> Result<String, JsError> {
    let mut state = master(m)?; state.registry.remove_label(family, label, &now()).map_err(e)?; save(state)
}

#[wasm_bindgen]
pub fn rename_wallet(m: &str, family: &str, old: &str, new: &str) -> Result<String, JsError> {
    let mut state = master(m)?; state.registry.rename_label(family, old, new, &now()).map_err(e)?; save(state)
}

#[wasm_bindgen]
pub fn derive_wallet_secret(m: &str, family: &str, label: &str) -> Result<String, JsError> {
    Ok(master(m)?.registry.derive_secret_for_label(family, label, &now()).map_err(e)?.0.to_string())
}

// ── Key derivation (extro-node HdRoot) ──────────────────────────

#[wasm_bindgen]
pub fn derive_vault_key(mnemonic: &str, purpose: &str) -> Result<String, JsError> {
    Ok(hd_root(Some(mnemonic))?.derive_slot_hex(family(purpose)?, 0).map_err(e)?.to_string())
}

#[wasm_bindgen]
pub fn derive_pgp_key(mnemonic: &str, index: u32) -> Result<String, JsError> {
    let root = hd_root(Some(mnemonic))?;
    let private_hex = root.derive_slot_hex(SlotFamily::Pgp, index).map_err(e)?;
    let public = root.derive_ed25519_public(SlotFamily::Pgp, index).map_err(e)?;
    Ok(serde_json::to_string(&serde_json::json!({"private_hex": private_hex.as_str(), "public_hex": hex::encode(public)})).map_err(e)?)
}

#[wasm_bindgen]
pub fn derive_identity(mnemonic: &str) -> Result<String, JsError> {
    Ok(hd_root(Some(mnemonic))?.derive_slot_hex(SlotFamily::Root, 0).map_err(e)?.to_string())
}

#[wasm_bindgen]
pub fn mnemonic_from_hex(hex: &str) -> Result<String, JsError> {
    Ok(HdRoot::from_entropy_hex(hex).map_err(e)?.mnemonic_words().map_err(e)?.to_string())
}

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

// ── GPU Mining (extro-node WebGPU miner + kernel) ───────────────

thread_local! {
    static GPU_MINER: RefCell<Option<Rc<GpuMiner>>> = const { RefCell::new(None) };
    static NONCE_TABLE: Rc<NonceTable> = Rc::new(NonceTable::new());
}

/// Open the WebGPU miner; the adapter name, or "" when WebGPU is unavailable.
#[wasm_bindgen]
pub async fn gpu_init() -> String {
    match GpuMiner::try_new().await {
        Some(m) => { let name = m.adapter_name().to_string(); GPU_MINER.with(|c| *c.borrow_mut() = Some(Rc::new(m))); name }
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

/// Mine one GPU batch. extro-node supplies the WebGPU nonce search and the
/// work-unit preimage format; target, report and claim are webylib.
/// The claim inserts the random keep secret through `/replace` into the HD
/// RECEIVE chain, so the wallet never holds a non-HD secret.
#[wasm_bindgen]
pub async fn gpu_mine(s: &str, n: &str) -> Result<String, JsError> {
    const BATCH: usize = 8;
    let wl = w(s, n)?;
    let miner = GPU_MINER.with(|c| c.borrow().clone()).ok_or_else(|| JsError::new("GPU not initialized"))?;
    let target = mining_target(&wl).await?;
    let difficulty = target.difficulty_target_bits;
    let mining = Amount::from_str(&target.mining_amount).map_err(e)?;
    let subsidy = Amount::from_str(&target.mining_subsidy_amount).map_err(e)?;
    let works: Vec<WorkUnit> = (0..BATCH).map(|_| WorkUnit::new(difficulty, mining, subsidy)).collect();
    let midstates: Vec<_> = works.iter().map(|w| w.midstate.clone()).collect();
    let chunks = miner.mine_batch(&midstates, difficulty).await.map_err(e)?;
    let attempted: u64 = chunks.iter().map(|c| c.attempted).sum();
    let mut out = serde_json::json!({"found": false, "attempted": attempted, "difficulty": difficulty, "mining_amount": mining.to_string()});
    if let Some((r, work)) = chunks.into_iter().zip(works).find_map(|(c, w)| c.result.map(|r| (r, w))) {
        let preimage = work.preimage_string(&NONCE_TABLE.with(Rc::clone), r.nonce1_idx, r.nonce2_idx);
        wl.server_submit_mining_report(&webylib::server::MiningReportRequest { preimage: preimage.clone(), legalese: webylib::server::Legalese { terms: true } })
            .await.map_err(e)?;
        wl.insert(work.keep_secret.clone()).await.map_err(e)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;
    use webylib::server_client::TokenStatus;

    const NET: &str = "https://webcash.invalid";

    #[wasm_bindgen_test]
    fn token_status_maps_to_the_ui_shape() {
        assert_eq!(token_status_json(&TokenStatus::Unknown), serde_json::json!({"spent": null, "amount": null}));
        assert_eq!(token_status_json(&TokenStatus::Unspent { amount: Some("1.5".into()) }), serde_json::json!({"spent": false, "amount": "1.5"}));
        assert_eq!(token_status_json(&TokenStatus::Spent { amount: Some("2".into()) }), serde_json::json!({"spent": true, "amount": "2"}));
    }

    #[wasm_bindgen_test]
    fn network_values_resolve_to_one_server() {
        assert!(matches!(net("production"), Ok(NetworkMode::Production)));
        assert!(matches!(net("testnet"), Ok(NetworkMode::Testnet)));
        assert!(matches!(net("https://dev.weby.cash/api/webcash/"), Ok(NetworkMode::Custom(u)) if u == "https://dev.weby.cash/api/webcash"));
        assert!(net("mainnet").is_err());
    }

    fn js_message(err: JsError) -> String { js_sys::Error::from(JsValue::from(err)).message().into() }
    fn ok<T>(r: Result<T, JsError>) -> T { r.map_err(js_message).unwrap() }
    fn json(s: &str) -> serde_json::Value { serde_json::from_str(s).unwrap() }
    /// Registry state with row timestamps dropped (they are wall-clock).
    fn timeless(state: &str) -> serde_json::Value {
        let mut v = json(state);
        for row in v["wallet_slots"].as_array_mut().unwrap() {
            let row = row.as_object_mut().unwrap();
            row.remove("created_at");
            row.remove("updated_at");
        }
        v
    }

    const FIXTURE: &str = include_str!("../tests/fixtures/harmoniis-0.1.121-master.json");

    /// The full legacy flow (create, add, rename, remove, list) replayed
    /// through the exports matches harmoniis-wallet 0.1.121 step by step.
    #[wasm_bindgen_test]
    fn master_flow_matches_harmoniis() {
        let f = json(FIXTURE);
        let words = ok(mnemonic_from_hex(f["create_entropy_hex"].as_str().unwrap()));
        let created = json(&ok(create_master_wallet(Some(words))));
        let mut state = created["master_state"].as_str().unwrap().to_string();
        let lists_match = |state: &str, want: &serde_json::Value, op: &str| {
            for (family, expected) in want.as_object().unwrap() {
                let got: serde_json::Value = serde_wasm_bindgen::from_value(ok(list_wallets(state, family))).unwrap();
                let expected = expected.get("ok").cloned().unwrap_or(serde_json::json!([]));
                assert!(got == expected, "{op}: list {family}");
            }
        };
        let steps = f["steps"].as_array().unwrap();
        assert!(timeless(&state) == timeless(&steps[0]["state"].to_string()), "create");
        lists_match(&state, &steps[0]["lists"], "create");
        for step in &steps[1..] {
            let (op, a) = (step["op"].as_str().unwrap(), step["args"].as_array().unwrap());
            let a: Vec<&str> = a.iter().map(|v| v.as_str().unwrap()).collect();
            let result = match op {
                "add" => derive_wallet_secret(&state, a[0], a[1]).and_then(|secret| {
                    assert_eq!(Some(secret.as_str()), step["out"]["ok"][0].as_str(), "add {a:?}");
                    add_wallet(&state, a[0], a[1])
                }),
                "rename" => rename_wallet(&state, a[0], a[1], a[2]),
                "remove" => remove_wallet(&state, a[0], a[1]),
                _ => unreachable!(),
            };
            match (result, step["out"].get("err").and_then(|e| e.as_str())) {
                (Ok(next), None) => state = next,
                (Err(err), Some(legacy)) => assert_eq!(js_message(err), format!("wallet: {legacy}"), "{op} {a:?}"),
                (r, legacy) => panic!("{op} {a:?}: ok={} legacy_err={legacy:?}", r.is_ok()),
            }
            assert!(timeless(&state) == timeless(&step["state"].to_string()), "{op} {a:?}: state");
            lists_match(&state, &step["lists"], op);
        }
    }

    /// `(entropy_hex, pgp index, public hex)` from harmoniis-wallet 0.1.121.
    #[wasm_bindgen_test]
    fn pgp_and_root_keys_match_harmoniis() {
        let words = ok(mnemonic_from_hex("00000000000000000000000000000000"));
        let pgp = json(&ok(derive_pgp_key(&words, 1)));
        assert_eq!(pgp["private_hex"], "38776f21f6c7d4a3a2c22036ff69ce15c14641950cf8eedd41ad3189e67d9890");
        assert_eq!(pgp["public_hex"], "a29c0f82152eecd7885ed6b5f8305eac39b3913f6a386e729ddbbbd8296f145b");
        assert_eq!(ok(derive_vault_key(&words, "harmonia-vault")), ok(derive_vault_key(&words, "vault")));
        assert!(derive_vault_key(&words, "ark").is_err());
        assert!(derive_pgp_key(&words, 1000).is_err());
        assert!(mnemonic_from_hex("zz").is_err());
    }

    #[wasm_bindgen_test]
    fn backups_round_trip_through_the_exports() {
        let f = json(FIXTURE);
        let imported = json(&ok(import_full_backup(f["backup_text"].as_str().unwrap())));
        let m = imported["master_state"].as_str().unwrap();
        assert!(json(m) == f["import"]["state"]);
        let wallets = imported["webcash_wallets"].to_string();
        let again = json(&ok(import_full_backup(&ok(export_full_backup(m, &wallets)))));
        assert!(again == imported);
        assert!(import_full_backup("{}").is_err());
        assert!(export_full_backup("{}", "{}").is_err(), "invalid master must not export");
    }

    /// An unreachable server fails the scan; nothing is half-registered.
    #[wasm_bindgen_test]
    async fn slot_scan_fails_closed() {
        let created = json(&ok(create_master_wallet(None)));
        let m = created["master_state"].as_str().unwrap();
        assert!(scan_webcash_slots(m, NET, 3, 2).await.is_err());
        assert!(scan_webcash_slots("{}", NET, 3, 2).await.is_err());
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
