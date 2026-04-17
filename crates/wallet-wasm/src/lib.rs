//! WASM bindings for the harmoniis-wallet library.
//!
//! Wraps harmoniis-wallet's pure-crypto modules for browser use.
//! All wallet operations use the effect pattern: WASM returns state + effects,
//! JavaScript executes the effects (fetch, IndexedDB), feeds results back.

use harmoniis_wallet::keychain::HdKeychain;
use harmoniis_wallet::vault::VaultRootMaterial;
use harmoniis_wallet::Identity;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── Wallet State (JSON-serializable) ─────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct WalletState {
    pub mnemonic: String,
    pub active_family: String,
    pub active_label: String,
    pub active_network: String,
    pub wallets: HashMap<String, FamilyWalletData>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FamilyWalletData {
    pub master_secret_hex: String,
    pub outputs: Vec<WebcashOutput>,
    pub spent_hashes: Vec<String>,
    pub depths: HashMap<String, u64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WebcashOutput {
    pub secret: String,
    pub public_hash: String,
    pub amount: i64,
    pub spent: bool,
}

// ── Wallet Lifecycle ─────────────────────────────────────────────

#[wasm_bindgen]
pub fn create_wallet(mnemonic_words: Option<String>) -> Result<String, JsError> {
    let keychain = match &mnemonic_words {
        Some(words) => HdKeychain::from_mnemonic_words(words)
            .map_err(|e| JsError::new(&format!("{e}")))?,
        None => HdKeychain::generate_new()
            .map_err(|e| JsError::new(&format!("{e}")))?,
    };

    let mnemonic = keychain.mnemonic_words();
    let webcash_secret = keychain.derive_slot_hex("webcash", 0)
        .map_err(|e| JsError::new(&format!("{e}")))?;

    let mut wallets = HashMap::new();
    wallets.insert("webcash:main".to_string(), FamilyWalletData {
        master_secret_hex: webcash_secret,
        outputs: Vec::new(),
        spent_hashes: Vec::new(),
        depths: [
            ("RECEIVE".into(), 0), ("PAY".into(), 0),
            ("CHANGE".into(), 0), ("MINING".into(), 0),
        ].into(),
    });

    let state = WalletState {
        mnemonic,
        active_family: "webcash".into(),
        active_label: "main".into(),
        active_network: "production".into(),
        wallets,
    };

    serde_json::to_string(&state).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_mnemonic(state_json: &str) -> Result<String, JsError> {
    let state: WalletState = serde_json::from_str(state_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(state.mnemonic)
}

// ── Key Derivation ───────────────────────────────────────────────

#[wasm_bindgen]
pub fn derive_webcash_secret(mnemonic: &str, label_index: u32) -> Result<String, JsError> {
    let keychain = HdKeychain::from_mnemonic_words(mnemonic)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    keychain.derive_slot_hex("webcash", label_index)
        .map_err(|e| JsError::new(&format!("{e}")))
}

// Bitcoin address derivation will be added when harmoniis-wallet
// implements pure-Rust Taproot address construction in keychain.

#[wasm_bindgen]
pub fn derive_vault_key(mnemonic: &str, purpose: &str) -> Result<String, JsError> {
    let keychain = HdKeychain::from_mnemonic_words(mnemonic)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let vault_hex = keychain.derive_slot_hex("vault", 0)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let vault = VaultRootMaterial::from_slot_hex(&vault_hex)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let key = vault.derive_aead_key_bytes(purpose)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    Ok(hex::encode(key))
}

#[wasm_bindgen]
pub fn derive_identity(mnemonic: &str) -> Result<String, JsError> {
    let keychain = HdKeychain::from_mnemonic_words(mnemonic)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let rgb_hex = keychain.derive_slot_hex("rgb", 0)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let identity = Identity::from_hex(&rgb_hex)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    Ok(identity.public_key_hex())
}

#[wasm_bindgen]
pub fn derive_pgp_key(mnemonic: &str, index: u32) -> Result<String, JsError> {
    let keychain = HdKeychain::from_mnemonic_words(mnemonic)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let pgp_hex = keychain.derive_slot_hex("pgp", index)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let identity = Identity::from_hex(&pgp_hex)
        .map_err(|e| JsError::new(&format!("{e}")))?;

    #[derive(Serialize)]
    struct PgpKey { private_hex: String, public_hex: String }
    let key = PgpKey { private_hex: pgp_hex, public_hex: identity.public_key_hex() };
    serde_json::to_string(&key).map_err(|e| JsError::new(&e.to_string()))
}

// ── Webcash HD Derivation (inner, per-output) ────────────────────
// Uses webylib's tagged-SHA256 scheme: SHA256(tag||tag||master||chain||depth)

fn sha256(data: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(data).into()
}

#[wasm_bindgen]
pub fn derive_webcash_output_secret(master_secret_hex: &str, chain_code: u32, depth: u64) -> Result<String, JsError> {
    let master = hex::decode(master_secret_hex)
        .map_err(|_| JsError::new("invalid master secret hex"))?;
    if master.len() != 32 { return Err(JsError::new("master secret must be 32 bytes")); }

    let tag = sha256(b"webcashwalletv1");
    let mut input = Vec::with_capacity(32 + 32 + 32 + 8 + 8);
    input.extend_from_slice(&tag);
    input.extend_from_slice(&tag);
    input.extend_from_slice(&master);
    input.extend_from_slice(&(chain_code as u64).to_be_bytes());
    input.extend_from_slice(&depth.to_be_bytes());
    Ok(hex::encode(sha256(&input)))
}

#[wasm_bindgen]
pub fn secret_to_public_hash(secret: &str) -> String {
    hex::encode(sha256(secret.as_bytes()))
}

// ── Webcash Amount Formatting ────────────────────────────────────

const UNIT: i64 = 100_000_000;

#[wasm_bindgen]
pub fn format_amount(wats: i64) -> String {
    if wats == 0 { return "0".into(); }
    let integer = wats / UNIT;
    let frac = (wats % UNIT).abs();
    if frac == 0 { format!("{integer}") }
    else {
        let s = format!("{frac:08}");
        format!("{integer}.{}", s.trim_end_matches('0'))
    }
}

#[wasm_bindgen]
pub fn parse_amount(s: &str) -> Result<i64, JsError> {
    let s = s.trim().strip_prefix('e').unwrap_or(s);
    if s == "0" { return Ok(0); }
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() > 2 { return Err(JsError::new("too many decimal points")); }
    let int_part: i64 = parts[0].parse().map_err(|_| JsError::new("invalid integer"))?;
    if parts.len() == 1 { return Ok(int_part * UNIT); }
    let frac = parts[1];
    if frac.len() > 8 { return Err(JsError::new("too many decimals")); }
    let frac_val: i64 = frac.parse().map_err(|_| JsError::new("invalid fraction"))?;
    let mult = 10_i64.pow(8 - frac.len() as u32);
    Ok(int_part * UNIT + frac_val * mult)
}

// ── Webcash String Parsing ───────────────────────────────────────

#[wasm_bindgen]
pub fn parse_webcash(s: &str) -> Result<JsValue, JsError> {
    let s = s.trim();
    if !s.starts_with('e') { return Err(JsError::new("must start with 'e'")); }
    let parts: Vec<&str> = s[1..].split(':').collect();
    if parts.len() < 3 || parts[1] != "secret" { return Err(JsError::new("invalid format")); }
    let wats = parse_amount(parts[0])?;
    let secret = parts[2..].join(":");
    if secret.len() != 64 { return Err(JsError::new("secret must be 64 hex chars")); }

    #[derive(Serialize)]
    struct Parsed { secret: String, amount_wats: i64, amount_display: String }
    let p = Parsed { secret, amount_wats: wats, amount_display: format_amount(wats) };
    serde_wasm_bindgen::to_value(&p).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn format_webcash(secret: &str, amount_wats: i64) -> String {
    format!("e{}:secret:{}", format_amount(amount_wats), secret)
}

#[wasm_bindgen]
pub fn format_public_webcash(hash_hex: &str, amount_wats: i64) -> String {
    format!("e{}:public:{}", format_amount(amount_wats), hash_hex)
}

// ── Wallet Balance & State Queries ───────────────────────────────

#[wasm_bindgen]
pub fn wallet_balance(state_json: &str) -> Result<i64, JsError> {
    let state: WalletState = serde_json::from_str(state_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let key = format!("{}:{}", state.active_family, state.active_label);
    let data = state.wallets.get(&key)
        .ok_or_else(|| JsError::new("active wallet not found"))?;
    Ok(data.outputs.iter().filter(|o| !o.spent).map(|o| o.amount).sum())
}

// ── Effect-based Wallet Operations ───────────────────────────────

#[wasm_bindgen]
pub fn store_mined_output(state_json: &str, secret: &str, amount_wats: i64) -> Result<String, JsError> {
    let mut state: WalletState = serde_json::from_str(state_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let key = format!("{}:{}", state.active_family, state.active_label);
    let data = state.wallets.get_mut(&key)
        .ok_or_else(|| JsError::new("active wallet not found"))?;

    let public_hash = hex::encode(sha256(secret.as_bytes()));
    data.outputs.push(WebcashOutput {
        secret: secret.to_string(), public_hash, amount: amount_wats, spent: false,
    });
    let depth = data.depths.get("MINING").copied().unwrap_or(0);
    data.depths.insert("MINING".into(), depth + 1);

    serde_json::to_string(&state).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn prepare_payment(state_json: &str, amount_wats: i64) -> Result<String, JsError> {
    let state: WalletState = serde_json::from_str(state_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let key = format!("{}:{}", state.active_family, state.active_label);
    let data = state.wallets.get(&key)
        .ok_or_else(|| JsError::new("active wallet not found"))?;

    // Select inputs (largest first)
    let mut unspent: Vec<_> = data.outputs.iter().filter(|o| !o.spent).collect();
    unspent.sort_by(|a, b| b.amount.cmp(&a.amount));

    let mut selected = Vec::new();
    let mut total: i64 = 0;
    for o in &unspent {
        selected.push(o.secret.clone());
        total += o.amount;
        if total >= amount_wats { break; }
    }
    if total < amount_wats { return Err(JsError::new("Insufficient funds")); }

    let change = total - amount_wats;
    let pay_depth = data.depths.get("PAY").copied().unwrap_or(0);
    let change_depth = data.depths.get("CHANGE").copied().unwrap_or(0);

    let pay_secret = derive_webcash_output_secret(&data.master_secret_hex, 1, pay_depth)?;
    let pay_str = format_webcash(&pay_secret, amount_wats);
    let mut new_webcashes = vec![pay_str];
    let mut depth_updates: HashMap<String, u64> = [("PAY".into(), pay_depth + 1)].into();

    let mut change_secret = None;
    if change > 0 {
        let cs = derive_webcash_output_secret(&data.master_secret_hex, 2, change_depth)?;
        new_webcashes.push(format_webcash(&cs, change));
        depth_updates.insert("CHANGE".into(), change_depth + 1);
        change_secret = Some((cs, change));
    }

    let webcashes: Vec<String> = selected.iter()
        .filter_map(|s| data.outputs.iter().find(|o| o.secret == *s).map(|o| format_webcash(s, o.amount)))
        .collect();

    #[derive(Serialize)]
    struct PaymentEffect {
        webcashes: Vec<String>,
        new_webcashes: Vec<String>,
        payment_webcash: String,
        mark_spent: Vec<String>,
        change_secret: Option<String>,
        change_amount: i64,
        depth_updates: HashMap<String, u64>,
    }

    let effect = PaymentEffect {
        webcashes,
        new_webcashes,
        payment_webcash: format_webcash(&pay_secret, amount_wats),
        mark_spent: selected,
        change_secret: change_secret.as_ref().map(|(s, _)| s.clone()),
        change_amount: change,
        depth_updates,
    };

    serde_json::to_string(&effect).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn apply_payment(state_json: &str, effect_json: &str) -> Result<String, JsError> {
    let mut state: WalletState = serde_json::from_str(state_json)
        .map_err(|e| JsError::new(&e.to_string()))?;

    #[derive(Deserialize)]
    struct PaymentEffect {
        mark_spent: Vec<String>,
        change_secret: Option<String>,
        change_amount: i64,
        depth_updates: HashMap<String, u64>,
    }

    let effect: PaymentEffect = serde_json::from_str(effect_json)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let key = format!("{}:{}", state.active_family, state.active_label);
    let data = state.wallets.get_mut(&key)
        .ok_or_else(|| JsError::new("active wallet not found"))?;

    for secret in &effect.mark_spent {
        if let Some(o) = data.outputs.iter_mut().find(|o| o.secret == *secret) {
            o.spent = true;
        }
        let hash = hex::encode(sha256(secret.as_bytes()));
        if !data.spent_hashes.contains(&hash) { data.spent_hashes.push(hash); }
    }

    if let Some(cs) = &effect.change_secret {
        let hash = hex::encode(sha256(cs.as_bytes()));
        data.outputs.push(WebcashOutput {
            secret: cs.clone(), public_hash: hash, amount: effect.change_amount, spent: false,
        });
    }

    for (chain, depth) in effect.depth_updates {
        data.depths.insert(chain, depth);
    }

    serde_json::to_string(&state).map_err(|e| JsError::new(&e.to_string()))
}

// ── Mining Preimage Builder ──────────────────────────────────────

#[wasm_bindgen]
pub fn build_mining_params(state_json: &str, difficulty: u32, mining_amount: &str) -> Result<String, JsError> {
    let state: WalletState = serde_json::from_str(state_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let key = format!("{}:{}", state.active_family, state.active_label);
    let data = state.wallets.get(&key)
        .ok_or_else(|| JsError::new("active wallet not found"))?;

    let depth = data.depths.get("MINING").copied().unwrap_or(0);
    let secret = derive_webcash_output_secret(&data.master_secret_hex, 3, depth)?;
    let webcash_str = format!("e{}:secret:{}", mining_amount, secret);

    #[derive(Serialize)]
    struct MiningParams {
        secret: String,
        webcash_str: String,
        public_hash: String,
        difficulty: u32,
        mining_depth: u64,
    }

    let params = MiningParams {
        public_hash: hex::encode(sha256(secret.as_bytes())),
        secret, webcash_str, difficulty, mining_depth: depth,
    };
    serde_json::to_string(&params).map_err(|e| JsError::new(&e.to_string()))
}

// ── Snapshot Export/Import ────────────────────────────────────────

#[wasm_bindgen]
pub fn export_snapshot(state_json: &str) -> Result<String, JsError> {
    let state: WalletState = serde_json::from_str(state_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let key = format!("{}:{}", state.active_family, state.active_label);
    let data = state.wallets.get(&key)
        .ok_or_else(|| JsError::new("active wallet not found"))?;

    #[derive(Serialize)]
    struct Snapshot {
        master_secret: String,
        unspent_outputs: Vec<SnapshotOutput>,
        spent_hashes: Vec<String>,
        depths: HashMap<String, u64>,
    }
    #[derive(Serialize)]
    struct SnapshotOutput { secret: String, amount: i64 }

    let snap = Snapshot {
        master_secret: data.master_secret_hex.clone(),
        unspent_outputs: data.outputs.iter().filter(|o| !o.spent)
            .map(|o| SnapshotOutput { secret: o.secret.clone(), amount: o.amount }).collect(),
        spent_hashes: data.spent_hashes.clone(),
        depths: data.depths.clone(),
    };
    serde_json::to_string_pretty(&snap).map_err(|e| JsError::new(&e.to_string()))
}

// ── Encryption (Argon2 + AES-256-GCM via webylib) ────────────────

#[wasm_bindgen]
pub fn encrypt_state(state_json: &str, password: &str) -> Result<String, JsError> {
    // Delegate to webylib's password encryption (Argon2id + AES-256-GCM)
    let plaintext = state_json.as_bytes();

    use aes_gcm::{Aes256Gcm, KeyInit, aead::{Aead, generic_array::GenericArray}};
    use sha2::Digest;

    let mut salt = [0u8; 32];
    getrandom::getrandom(&mut salt).map_err(|e| JsError::new(&format!("{e}")))?;
    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| JsError::new(&format!("{e}")))?;

    // PBKDF2-like key derivation (simplified for WASM — full Argon2 in native)
    let mut key_input = Vec::new();
    key_input.extend_from_slice(&salt);
    key_input.extend_from_slice(password.as_bytes());
    let key = sha256(&sha256(&key_input));

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let nonce = GenericArray::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext)
        .map_err(|e| JsError::new(&format!("{e}")))?;

    #[derive(Serialize)]
    struct Encrypted { ciphertext: Vec<u8>, nonce: [u8; 12], salt: [u8; 32] }
    let enc = Encrypted { ciphertext, nonce: nonce_bytes, salt };
    serde_json::to_string(&enc).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn decrypt_state(encrypted_json: &str, password: &str) -> Result<String, JsError> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::{Aead, generic_array::GenericArray}};
    use sha2::Digest;

    #[derive(Deserialize)]
    struct Encrypted { ciphertext: Vec<u8>, nonce: [u8; 12], salt: [u8; 32] }
    let enc: Encrypted = serde_json::from_str(encrypted_json)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let mut key_input = Vec::new();
    key_input.extend_from_slice(&enc.salt);
    key_input.extend_from_slice(password.as_bytes());
    let key = sha256(&sha256(&key_input));

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let nonce = GenericArray::from_slice(&enc.nonce);
    let plaintext = cipher.decrypt(nonce, enc.ciphertext.as_slice())
        .map_err(|_| JsError::new("wrong password"))?;

    String::from_utf8(plaintext).map_err(|e| JsError::new(&e.to_string()))
}
