/**
 * Read-only Bitcoin ARK view (signet, default Arkade ASP). The owner key is
 * derived INSIDE the WASM (`DeriveFamilyHandle` Ark → `ark:vtxo:<owner>:<asp>:<delay>`);
 * only the public x-only key reaches JS. From it we build the standard Arkade
 * VTXO + boarding scripts and query the ASP indexer / esplora. No spending here.
 */
import {
	DefaultVtxo,
	ESPLORA_URL,
	RestArkProvider,
	RestIndexerProvider,
	getNetwork,
	type RelativeTimelock
} from '@arkade-os/sdk';
import { getExtroClient } from '$lib/extro';
import { newRequestId } from '@extro/node';
import { getRuntimeConfig } from '$lib/extro/release-config';

export type ArkVtxoRow = { outpoint: string; sats: number; state: string; expiresAt?: number };
export type ArkOverview = {
	ownerXonly: string;
	arkAddress: string;
	boardingAddress: string;
	offchainSats: number;
	boardingSats: number;
	boardingUnconfirmedSats: number;
	vtxos: ArkVtxoRow[];
	asp: string;
	network: string;
};

const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const timelock = (d: bigint): RelativeTimelock => ({ value: d, type: d < 512n ? 'blocks' : 'seconds' });

export async function loadArkOverview(): Promise<ArkOverview> {
	const config = getRuntimeConfig();
	if (!config.ark_enabled) throw new Error('Bitcoin ARK is disabled on this deployment');
	const asp = config.ark_asp_url;
	const info = await new RestArkProvider(asp).getInfo();
	const serverXonly = info.signerPubkey.length === 66 ? info.signerPubkey.slice(2) : info.signerPubkey;
	if (serverXonly.toLowerCase() !== config.ark_signer_pk_hex.toLowerCase()) {
		throw new Error('ASP signer key does not match the pinned operator key');
	}
	const res = await getExtroClient().send({
		request_id: newRequestId(),
		op: {
			kind: 'Wallet',
			cmd: {
				op: 'DeriveFamilyHandle',
				family: 'Ark',
				slot: 0,
				index: 0,
				namespace: [serverXonly, String(info.unilateralExitDelay)]
			}
		}
	});
	if (res.kind === 'Err') throw new Error(res.message);
	if (res.body.kind !== 'FamilyHandle') throw new Error(`unexpected ${res.body.kind}`);
	const m = /^ark:vtxo:([0-9a-f]{64}):/i.exec(res.body.address);
	if (!m) throw new Error('Ark handle did not carry an owner key');
	const ownerXonly = m[1].toLowerCase();

	const network = getNetwork(info.network as Parameters<typeof getNetwork>[0]);
	const serverPub = hexToBytes(serverXonly);
	const offchain = new DefaultVtxo.Script({
		pubKey: hexToBytes(ownerXonly),
		serverPubKey: serverPub,
		csvTimelock: timelock(info.unilateralExitDelay)
	});
	const boarding = new DefaultVtxo.Script({
		pubKey: hexToBytes(ownerXonly),
		serverPubKey: serverPub,
		csvTimelock: timelock(info.boardingExitDelay)
	});
	const arkAddress = offchain.address(network.hrp, serverPub).encode();
	const boardingAddress = boarding.onchainAddress(network);

	const { vtxos } = await new RestIndexerProvider(asp).getVtxos({ scripts: [toHex(offchain.pkScript)] });
	const rows: ArkVtxoRow[] = vtxos.map((v) => ({
		outpoint: `${v.txid}:${v.vout}`,
		sats: Number(v.value),
		state: v.isSpent ? 'spent' : (v.virtualStatus?.state ?? 'unknown'),
		expiresAt: v.virtualStatus?.batchExpiry
	}));
	const offchainSats = rows.filter((r) => r.state !== 'spent').reduce((s, r) => s + r.sats, 0);

	let boardingSats = 0;
	let boardingUnconfirmedSats = 0;
	try {
		const esplora = ESPLORA_URL[info.network as keyof typeof ESPLORA_URL];
		const utxos = (await (await fetch(`${esplora}/address/${boardingAddress}/utxo`)).json()) as {
			value: number;
			status: { confirmed: boolean };
		}[];
		for (const u of utxos) {
			if (u.status.confirmed) boardingSats += u.value;
			else boardingUnconfirmedSats += u.value;
		}
	} catch {
		/* esplora unreachable: boarding balance unknown (shown as 0) */
	}
	return {
		ownerXonly,
		arkAddress,
		boardingAddress,
		offchainSats,
		boardingSats,
		boardingUnconfirmedSats,
		vtxos: rows,
		asp,
		network: info.network
	};
}
