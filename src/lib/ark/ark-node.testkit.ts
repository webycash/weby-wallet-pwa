/**
 * Test kit: the real extro-node WASM this wallet pins, booted ephemerally, for
 * tests of the thin `Op::Ark` wrappers (no mock of the protocol under test),
 * plus the cross-backend ceremony vector extro-node ships and pins in its own
 * Rust and JS suites. Test-only: imports `node:fs`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
	BundledExtroAdapter,
	loadExtroNodeWasm,
	parseRuntimeConfig,
	type ExtroCommand,
	type ExtroResponse,
	type WireArkOperatorInfo
} from '@extro/node';

const require = createRequire(import.meta.url);

/** `@extro/node/vectors/ark_ceremony.json` (per-swap tweaked, audit C1). */
export interface ArkCeremonyVector {
	swap_id: string;
	request_commitment_hex: string;
	referee_pubkey_hex: string;
	provider_pubkey_hex: string;
	owner_q_xonly_hex: string;
	sighashes_hex: string;
	settlement_binding_hex: string;
	referee_nonces_hex: string;
	provider_nonces_hex: string;
	referee_partials_hex: string;
	provider_partials_hex: string;
	signatures_hex: string[];
}

export const arkCeremonyVector = (): ArkCeremonyVector =>
	JSON.parse(readFileSync(require.resolve('@extro/node/vectors/ark_ceremony.json'), 'utf8'));

/** `@extro/node/vectors/ark_tx_ops.json`: one swap contract and both claims (regtest). */
export interface ArkTxOpsVector {
	swap_id: string;
	request_commitment_hex: string;
	referee_pubkey_hex: string;
	provider_pubkey_hex: string;
	owner_q_hex: string;
	network: 'regtest';
	exit_delay: number;
	operator: WireArkOperatorInfo;
	operator_info_digest_hex: string;
	operator_signer_pk_hex: string;
	address: string;
	script_pubkey_hex: string;
	tap_tree_hex: string;
	forfeit_script_hex: string;
	recovery_script_hex: string;
	locked_ref: string;
	amount_sats: number;
	settle_destination: string;
	refund_destination: string;
	settle_bundle_hex: string;
	refund_bundle_hex: string;
}

export const arkTxOpsVector = (): ArkTxOpsVector =>
	JSON.parse(readFileSync(require.resolve('@extro/node/vectors/ark_tx_ops.json'), 'utf8'));

// Public placeholder trust values only; Op::Ark reads no configuration.
const config = {
	schema_version: 2,
	deployment: 'development',
	db_name: 'ark-node-testkit',
	adapter_mode: 'bundled',
	keyserver_url: 'https://key.example',
	keyserver_domain: 'key.example',
	keyserver_fingerprint_hex: '11'.repeat(20),
	keyserver_vk_hex: '12'.repeat(32),
	referee_url: 'https://referee.example',
	referee_vk_hex: '13'.repeat(32),
	webcash_server_url: 'https://webcash.example',
	voucher_server_url: 'https://voucher.example',
	rgb_server_url: 'https://rgb.example',
	rgb_collectible_server_url: 'https://rgb21.example',
	ark_enabled: false,
	ark_network: 'signet',
	ark_asp_url: '',
	ark_signer_pk_hex: '',
	ark_info_digest_hex: '',
	ark_checkpoint_tapscript_hex: '',
	ark_unilateral_exit_delay: 0,
	zkp_profile: 'development-only',
	zkp_bearer_vk_sha256: '18'.repeat(32),
	zkp_conditional_vk_sha256: '19'.repeat(32),
	ice_servers: ['stun:stun.example:3478'],
	turn_servers: [{ url: 'turn:turn.example:443', username: 'u', credential: 'c' }],
	hub_bridge_origins: []
};

/** A booted, ephemeral extro-node exposing the facade's `send`. */
export async function bootArkNode(): Promise<{ send(command: ExtroCommand): Promise<ExtroResponse> }> {
	const adapter = new BundledExtroAdapter({
		load: () => loadExtroNodeWasm(readFileSync(require.resolve('@extro/node/wasm/extro_node_bg.wasm'))),
		bootConfig: parseRuntimeConfig(config),
		storage: 'ephemeral'
	});
	await adapter.boot();
	return { send: (command) => adapter.dispatch(command) };
}
