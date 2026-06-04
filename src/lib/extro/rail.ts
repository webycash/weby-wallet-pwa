// Rail operations over the extro facade (Op::Rail).
//
// The Bitcoin / Voucher / RGB tabs drive their value-moving + balance ops
// through here. Each helper dispatches ONE typed `Op::Rail` command and projects
// the response into a {@link RailOutcome}:
//
//   * `ok`      — the rail returned a real result (functional NOW).
//   * `pending` — the rail returned `Err { code: 'Unsupported' }`; the op is
//                 wired but the underlying logic is native-only / not in the
//                 current wasm pkg. The UI renders an honest "via extro-node
//                 (pending)" state — NEVER faked success.
//   * `error`   — any other failure (validation, network, locked wallet, …).
//
// When the rail-rework pkg lands, the SAME commands start returning real bodies
// and these helpers go live with no TypeScript change.
//
// Pure, declarative wrappers: map UI inputs → one command, dispatch, project.
// No mutation, no side effects beyond the single facade round-trip.

import { getExtroClient } from './index';
import { newRequestId, isOk, type RailCommand, type ResponseBody } from './commands';
import { railEndpoints } from './config';
import { getNetwork } from '$lib/stores/network.svelte';

/**
 * Discriminated rail result. `pending` is distinct from `error`: it means the
 * command round-tripped to extro-node and came back `Unsupported`, so the UI
 * shows a clean coming-soon state rather than a failure.
 */
export type RailOutcome<T> =
	| { state: 'ok'; value: T }
	| { state: 'pending' }
	| { state: 'error'; message: string };

/**
 * Dispatch one `Op::Rail` command and narrow its response to `body`'s arm.
 * Returns a {@link RailOutcome}: maps `Err { code: 'Unsupported' }` → `pending`,
 * any other `Err` → `error`, an unexpected `Ok` body → `error`, and the matching
 * `Ok` body → `ok`. Never throws.
 */
export async function dispatchRail<K extends ResponseBody['kind']>(
	cmd: RailCommand,
	expect: K
): Promise<RailOutcome<Extract<ResponseBody, { kind: K }>>> {
	try {
		const res = await getExtroClient().send({
			request_id: newRequestId(),
			op: { kind: 'Rail', cmd }
		});
		if (isOk(res)) {
			if (res.body.kind === expect)
				return { state: 'ok', value: res.body as Extract<ResponseBody, { kind: K }> };
			return { state: 'error', message: `Unexpected response: ${res.body.kind}` };
		}
		if (res.code === 'Unsupported') return { state: 'pending' };
		return { state: 'error', message: res.message };
	} catch (e) {
		return { state: 'error', message: `${e}` };
	}
}

// ── Bitcoin ──────────────────────────────────────────────────────────────────

/** Sync the slot's BIP86 P2TR balance via esplora. Functional NOW. */
export const bitcoinBalance = (slot = 0) => {
	const e = railEndpoints(getNetwork());
	return dispatchRail(
		{ op: 'BitcoinBalance', slot, network: e.network, esplora_url: e.esploraUrl },
		'BitcoinBalance'
	);
};

/** Build → sign → broadcast an on-chain payment. Native-only (pending on wasm). */
export const bitcoinSend = (args: {
	to: string;
	amountSat: bigint;
	feeRateSatPerVb: bigint;
	slot?: number;
}) => {
	const e = railEndpoints(getNetwork());
	return dispatchRail(
		{
			op: 'BitcoinSend',
			slot: args.slot ?? 0,
			network: e.network,
			to: args.to,
			amount_sat: args.amountSat,
			fee_rate_sat_per_vb: args.feeRateSatPerVb,
			esplora_url: e.esploraUrl
		},
		'BitcoinSent'
	);
};

// ── Voucher ────────────────────────────────────────────────────────────────--

/** Local balance over held bearer tokens. Native-only (pending on wasm). */
export const voucherBalance = (tokens: string[]) =>
	dispatchRail({ op: 'VoucherBalance', tokens }, 'RailBalance');

/** Issuer-signed mint via the voucher server. Native-only (pending on wasm). */
export const voucherIssue = (args: {
	amount: string;
	contract: string;
	nonce?: string;
	slot?: number;
}) => {
	const e = railEndpoints(getNetwork());
	return dispatchRail(
		{
			op: 'VoucherIssue',
			slot: args.slot ?? 0,
			server_url: e.voucherUrl,
			amount: args.amount,
			contract: args.contract,
			nonce: args.nonce ?? ''
		},
		'RailIssued'
	);
};

/** Transfer a held bearer secret to a recipient output. Native-only (pending). */
export const voucherTransfer = (args: { input: string; recipient: string }) => {
	const e = railEndpoints(getNetwork());
	return dispatchRail(
		{ op: 'VoucherTransfer', server_url: e.voucherUrl, input: args.input, recipient: args.recipient },
		'RailTransferred'
	);
};

/** Redeem-check a bearer secret against the server. Native-only (pending). */
export const voucherRedeem = (secret: string) => {
	const e = railEndpoints(getNetwork());
	return dispatchRail({ op: 'VoucherRedeem', server_url: e.voucherUrl, secret }, 'RailRedeemed');
};

// ── RGB ────────────────────────────────────────────────────────────────────--

import type { WireRgbFlavor } from './commands';

/** Local RGB balance/assets over held bearer tokens. Native-only (pending). */
export const rgbBalance = (tokens: string[]) =>
	dispatchRail({ op: 'RgbBalance', tokens }, 'RailBalance');

/** List held RGB contract namespaces. Native-only (pending). */
export const rgbContracts = (tokens: string[]) =>
	dispatchRail({ op: 'RgbContracts', tokens }, 'RailContracts');

/** Issuer-signed RGB mint. Native-only (pending on wasm). */
export const rgbIssue = (args: {
	flavor: WireRgbFlavor;
	amount: string;
	contract: string;
	nonce?: string;
	slot?: number;
}) => {
	const e = railEndpoints(getNetwork());
	return dispatchRail(
		{
			op: 'RgbIssue',
			slot: args.slot ?? 0,
			server_url: e.rgbUrl,
			flavor: args.flavor,
			amount: args.amount,
			contract: args.contract,
			nonce: args.nonce ?? ''
		},
		'RailIssued'
	);
};

/** Transfer ownership of a held RGB bearer secret. Native-only (pending). */
export const rgbTransfer = (args: {
	flavor: WireRgbFlavor;
	input: string;
	recipient: string;
}) => {
	const e = railEndpoints(getNetwork());
	return dispatchRail(
		{
			op: 'RgbTransfer',
			server_url: e.rgbUrl,
			flavor: args.flavor,
			input: args.input,
			recipient: args.recipient
		},
		'RailTransferred'
	);
};
