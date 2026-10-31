/**
 * Board confirmed on-chain boarding outputs into Ark VTXOs through the pinned
 * ASP (Arkade SDK `settle()`). Every signature comes from the extro-node WASM
 * (`WasmArkIdentity`); JS only drives the ASP round. Fails closed when the
 * SDK's boarding address differs from the WASM-derived one shown in the view.
 */
import { WasmArkIdentity } from './wasm-identity';
import { getRuntimeConfig } from '$lib/extro/release-config';

export type BoardEvent = { type: string };

export async function boardArk(
	expectedBoardingAddress: string,
	onEvent?: (e: BoardEvent) => void
): Promise<{ arkTxId: string; boardedSats: number; inputs: string[] }> {
	const cfg = getRuntimeConfig();
	if (!cfg.ark_enabled) throw new Error('Bitcoin ARK is disabled on this deployment');
	const { Wallet } = await import('@arkade-os/sdk');
	// settlementConfig:false — no background auto-settle racing this explicit
	// settle for the same boarding input (it caused INVALID_INTENT_PROOF).
	const wallet = await Wallet.create({
		identity: new WasmArkIdentity(0),
		arkServerUrl: cfg.ark_asp_url,
		settlementConfig: false
	});
	try {
		const sdkBoarding = await wallet.getBoardingAddress();
		if (sdkBoarding !== expectedBoardingAddress) {
			throw new Error(`boarding address mismatch (sdk ${sdkBoarding} != wasm ${expectedBoardingAddress})`);
		}
		const boarding = await wallet.getBoardingUtxos();
		const confirmed = boarding.filter((u) => u.status?.confirmed);
		if (confirmed.length === 0) throw new Error('no confirmed boarding outputs to board yet');
		// No explicit params: the SDK settles every eligible boarding input (and
		// preconfirmed VTXO) back to this wallet's own Ark address, net of ASP fees.
		const arkTxId = await wallet.settle(undefined, (e) =>
			onEvent?.({ type: String((e as { type?: unknown }).type ?? 'event') })
		);
		return {
			arkTxId,
			boardedSats: confirmed.reduce((s, u) => s + Number(u.value), 0),
			inputs: confirmed.map((u) => `${u.txid}:${u.vout}`)
		};
	} finally {
		await (wallet as { dispose?: () => Promise<void> }).dispose?.().catch(() => {});
	}
}
