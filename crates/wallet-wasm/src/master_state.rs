//! Weby master-state wire: the JSON the PWA stores for the master registry
//! (`MemState`) and full backups (`FullBackup`), byte-compatible with
//! harmoniis-wallet 0.1.121 so existing wallets keep loading.
//!
//! The registry itself is extro-node's `SlotRegistry`; extro-node carries no
//! serde, so this binding owns the JSON adapter. Records the PWA never edits
//! (payments, contracts, certificates, PGP rows) pass through untouched.

use std::collections::BTreeMap;

use extro_node::wallet::slot_registry::{LabeledWallet, SlotRegistry, WalletSlot};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

/// One `wallet_slots` row, field order as harmoniis writes it.
#[derive(Serialize, Deserialize)]
struct SlotRow {
    family: String,
    slot_index: u32,
    descriptor: Zeroizing<String>,
    db_rel_path: Option<String>,
    label: Option<String>,
    created_at: String,
    updated_at: String,
}

/// Every field is required, as in harmoniis (no `serde(default)`): a
/// truncated or foreign document fails closed instead of loading empty.
#[derive(Serialize, Deserialize)]
struct Wire {
    meta: BTreeMap<String, Zeroizing<String>>,
    pgp_identities: Vec<Value>,
    wallet_slots: Vec<SlotRow>,
    payment_attempts: Vec<Value>,
    payment_losses: Vec<Value>,
    payment_blacklist: Vec<Value>,
    payment_transactions: Vec<Value>,
    payment_transaction_events: Vec<Value>,
    contracts: Vec<Value>,
    certificates: Vec<Value>,
}

/// Records carried through unchanged.
#[derive(Default)]
struct Records {
    pgp_identities: Vec<Value>,
    payment_attempts: Vec<Value>,
    payment_losses: Vec<Value>,
    payment_blacklist: Vec<Value>,
    payment_transactions: Vec<Value>,
    payment_transaction_events: Vec<Value>,
    contracts: Vec<Value>,
    certificates: Vec<Value>,
}

/// A loaded master state: the slot registry plus pass-through records.
pub struct MasterState {
    pub registry: SlotRegistry,
    records: Records,
}

impl MasterState {
    pub fn new(registry: SlotRegistry) -> Self {
        Self { registry, records: Records::default() }
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        let wire: Wire = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let slots = wire
            .wallet_slots
            .into_iter()
            .map(|r| WalletSlot {
                family: r.family,
                slot_index: r.slot_index,
                descriptor: r.descriptor,
                db_rel_path: r.db_rel_path,
                label: r.label,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect();
        Ok(Self {
            registry: SlotRegistry { meta: wire.meta, slots },
            records: Records {
                pgp_identities: wire.pgp_identities,
                payment_attempts: wire.payment_attempts,
                payment_losses: wire.payment_losses,
                payment_blacklist: wire.payment_blacklist,
                payment_transactions: wire.payment_transactions,
                payment_transaction_events: wire.payment_transaction_events,
                contracts: wire.contracts,
                certificates: wire.certificates,
            },
        })
    }

    /// Compact JSON, as harmoniis `MemHarmoniiStore::to_json`.
    pub fn to_json(self) -> Result<String, String> {
        let Self { registry, records: r } = self;
        let wire = Wire {
            meta: registry.meta,
            pgp_identities: r.pgp_identities,
            wallet_slots: registry
                .slots
                .into_iter()
                .map(|s| SlotRow {
                    family: s.family,
                    slot_index: s.slot_index,
                    descriptor: s.descriptor,
                    db_rel_path: s.db_rel_path,
                    label: s.label,
                    created_at: s.created_at,
                    updated_at: s.updated_at,
                })
                .collect(),
            payment_attempts: r.payment_attempts,
            payment_losses: r.payment_losses,
            payment_blacklist: r.payment_blacklist,
            payment_transactions: r.payment_transactions,
            payment_transaction_events: r.payment_transaction_events,
            contracts: r.contracts,
            certificates: r.certificates,
        };
        serde_json::to_string(&wire).map_err(|e| e.to_string())
    }
}

/// `list_wallets` row: `{family, label, slot_index, db_filename, descriptor}`.
#[derive(Serialize)]
pub struct LabeledWalletJson<'a> {
    family: &'a str,
    label: &'a str,
    slot_index: u32,
    db_filename: &'a str,
    descriptor: &'a str,
}

impl<'a> From<&'a LabeledWallet> for LabeledWalletJson<'a> {
    fn from(w: &'a LabeledWallet) -> Self {
        Self {
            family: &w.family,
            label: &w.label,
            slot_index: w.slot_index,
            db_filename: &w.db_filename,
            descriptor: w.descriptor.as_str(),
        }
    }
}

/// Full backup: master state + webcash wallet states by label.
#[derive(Serialize, Deserialize)]
pub struct FullBackup {
    pub master_state: String,
    pub webcash_wallets: BTreeMap<String, String>,
    pub created_at: String,
}

impl FullBackup {
    /// Pretty JSON of a validated master state (re-encoded, as harmoniis
    /// `export_full_backup` does) and the wallet states.
    pub fn export(
        master: MasterState,
        webcash_wallets: BTreeMap<String, String>,
        created_at: String,
    ) -> Result<String, String> {
        let backup = Self { master_state: master.to_json()?, webcash_wallets, created_at };
        serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
    }

    /// Parse and validate a backup; errors read `invalid backup: …` for the
    /// envelope and the raw master-state error otherwise (harmoniis text).
    pub fn import(json: &str) -> Result<(MasterState, BTreeMap<String, String>), String> {
        let backup: Self =
            serde_json::from_str(json).map_err(|e| format!("invalid backup: {e}"))?;
        Ok((MasterState::from_json(&backup.master_state)?, backup.webcash_wallets))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    const FIXTURE: &str = include_str!("../tests/fixtures/harmoniis-0.1.121-master.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).unwrap()
    }

    fn round_trip(state: &Value) -> Value {
        let json = MasterState::from_json(&state.to_string()).unwrap().to_json().unwrap();
        serde_json::from_str(&json).unwrap()
    }

    #[wasm_bindgen_test]
    fn every_harmoniis_state_round_trips_unchanged() {
        for step in fixture()["steps"].as_array().unwrap() {
            assert!(round_trip(&step["state"]) == step["state"], "{} changed", step["op"]);
        }
    }

    #[wasm_bindgen_test]
    fn pass_through_records_survive() {
        let mut state = fixture()["steps"][0]["state"].clone();
        state["contracts"] = serde_json::json!([{"id": "c1", "nested": {"k": [1, 2]}}]);
        state["payment_blacklist"] = serde_json::json!([{"x": true}]);
        assert!(round_trip(&state) == state);
    }

    #[wasm_bindgen_test]
    fn truncated_state_fails_closed() {
        let mut state = fixture()["steps"][0]["state"].clone();
        state.as_object_mut().unwrap().remove("certificates");
        let err = MasterState::from_json(&state.to_string()).err().unwrap();
        assert!(err.starts_with("missing field `certificates`"), "{err}");
        assert!(MasterState::from_json("{}").is_err());
    }

    #[wasm_bindgen_test]
    fn backup_import_matches_harmoniis() {
        let f = fixture();
        let (master, wallets) = FullBackup::import(f["backup_text"].as_str().unwrap()).unwrap();
        let state: Value = serde_json::from_str(&master.to_json().unwrap()).unwrap();
        assert!(state == f["import"]["state"], "imported master differs");
        assert_eq!(serde_json::to_value(&wallets).unwrap(), f["import"]["wallets"]);
        for bad in ["{\"master_state\":\"{}\",\"webcash_wallets\":{}}", "{}"] {
            let err = FullBackup::import(bad).err().unwrap();
            let want = if bad == "{}" { &f["import_bad2"]["err"] } else { &f["import_bad"]["err"] };
            assert_eq!(err, want.as_str().unwrap());
        }
    }

    #[wasm_bindgen_test]
    fn backup_export_round_trips() {
        let f = fixture();
        let (master, wallets) = FullBackup::import(f["backup_text"].as_str().unwrap()).unwrap();
        let text = FullBackup::export(master, wallets.clone(), "2026-10-31T21:16:26.806+00:00".into()).unwrap();
        let ours: Value = serde_json::from_str(&text).unwrap();
        let theirs: Value = serde_json::from_str(f["backup_text"].as_str().unwrap()).unwrap();
        let master_of = |v: &Value| serde_json::from_str::<Value>(v["master_state"].as_str().unwrap()).unwrap();
        assert!(master_of(&ours) == master_of(&theirs));
        assert_eq!(ours["webcash_wallets"], theirs["webcash_wallets"]);
        assert_eq!(ours["created_at"], theirs["created_at"]);
        let (again, _) = FullBackup::import(&text).unwrap();
        assert!(again.registry.slots.len() == master_of(&theirs)["wallet_slots"].as_array().unwrap().len());
    }
}
