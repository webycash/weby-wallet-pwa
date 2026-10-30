/**
 * Resolve / check the exact funded 2-of-2 VTXO outpoint (`txid:vout`) from the
 * Ark indexer. Neither side trusts a DHTX `locked_ref` without re-reading it.
 */
import type { ArkSwapContract } from './swap-contract';

export interface ArkIndexerReader {
	getVtxos(filter: { scripts: string[] }): Promise<{
		vtxos: Array<{ txid: string; vout: number; value: number | bigint; isSpent?: boolean; script?: string }>;
	}>;
}

type Vtxo = Awaited<ReturnType<ArkIndexerReader['getVtxos']>>['vtxos'][number];

const matches = (v: Vtxo, contract: ArkSwapContract) =>
	!v.isSpent &&
	BigInt(v.value) === contract.plan.amountSats &&
	(v.script === undefined || v.script.toLowerCase() === contract.pkScriptHex.toLowerCase());

/** Provider: find the single unspent VTXO of the contract created by `arkTxId`. */
export async function resolveFundedLockedRef(
	reader: ArkIndexerReader,
	contract: ArkSwapContract,
	arkTxId: string,
	opts: { attempts?: number; intervalMs?: number } = {}
): Promise<string> {
	const attempts = opts.attempts ?? 10;
	const txid = arkTxId.toLowerCase();
	let found = 0;
	for (let i = 0; i < attempts; i++) {
		const { vtxos } = await reader.getVtxos({ scripts: [contract.pkScriptHex] });
		const hits = vtxos.filter((v) => v.txid.toLowerCase() === txid && matches(v, contract));
		found = hits.length;
		if (hits.length === 1) return `${txid}:${hits[0].vout}`;
		if (hits.length > 1) break;
		if (i + 1 < attempts) await new Promise((r) => setTimeout(r, opts.intervalMs ?? 1_500));
	}
	throw new Error(`funded Ark tx ${txid} resolved to ${found} contract VTXOs, expected exactly one`);
}

/** Seller: the published locked_ref must be an unspent VTXO of exactly this contract + amount. */
export async function assertFundedLockedRef(
	reader: ArkIndexerReader,
	contract: ArkSwapContract,
	lockedRef: string
): Promise<void> {
	const m = /^([0-9a-f]{64}):(\d+)$/i.exec(lockedRef);
	if (!m) throw new Error('Ark locked_ref must be an exact txid:vout');
	const { vtxos } = await reader.getVtxos({ scripts: [contract.pkScriptHex] });
	const hit = vtxos.filter(
		(v) => v.txid.toLowerCase() === m[1].toLowerCase() && v.vout === Number(m[2]) && matches(v, contract)
	);
	if (hit.length !== 1) throw new Error(`provider locked_ref ${lockedRef} is not an unspent VTXO of this contract`);
}
