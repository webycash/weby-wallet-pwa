// Webycash referee client.
//
// Targets the referee REST shapes (webycash/webycash-referee/src/api/router.rs):
//
//   GET  /v1/health
//   GET  /v1/pubkey
//   POST /v1/swap/prepare          (rkyv PrepareRequest bytes, octet-stream)
//   POST /v1/swap/initiate         (rkyv InitiateRequest bytes, octet-stream)
//   POST /v1/swap/:id/advance
//   POST /v1/swap/:id/ack
//   GET  /v1/swap/:id/audit
//   GET  /v1/party/:fp/swaps
//
// The module does NOT implement the referee state machine — it only calls it,
// and treats the referee as a MEDIATOR, never as custody (per the security
// invariants). Application code has no default or fallback referee: the strict
// runtime config installs the pinned HTTP client before exchange actions run.
// Test doubles live in `mock-referee-client.ts`, which production code never
// imports.

import { newRequestId, type RefereeCall, type RefereeReply } from '@extro/node';
import { getExtroClient } from '$lib/extro';
import type { ExtroSend } from './exchange-core';

/**
 * One audit entry as served by GET /v1/swap/:id/audit (the referee's
 * `AuditEntry`). `phase_payload` is the entry's public JSON (compact);
 * `signature` is '' when the referee did not sign the entry.
 */
export interface AuditEntry {
	swap_id: string;
	phase: string;
	ts_unix: number;
	prior_tip: string;
	phase_payload: string;
	signature: string;
}

export interface AdvanceResult {
	swapId: string;
	phase: string;
	terminal: boolean;
}

export interface RefereeHealth {
	status: string;
	version: string;
}

export interface RefereePubkey {
	ed25519_pubkey_hex: string;
	musig2_pubshare_hex: string;
	referee_version: string;
	/** Protocol capabilities (referee ≥ 0e02d05), e.g. `settle-ceremony-v1`. Absent on older builds. */
	capabilities?: string[];
}

/**
 * The bearer seller's signed ack POSTed to /v1/swap/:id/ack (the referee's
 * `BearerSellerAck`). Never carries a secret.
 */
export interface WalletAck {
	swap_id: string;
	outcome: string;
	signature_hex: string;
}

/** The referee's reply to `POST /v1/swap/initiate`. */
export interface InitiateResult {
	swap_id: string;
	phase: string;
}

export interface RefereeClient {
	readonly mode: 'mock' | 'http';
	health(): Promise<RefereeHealth>;
	pubkey(): Promise<RefereePubkey>;
	/**
	 * Submit the dual-signed, value-free rkyv `PrepareRequest`. The returned
	 * bytes are the referee's `Signed<PreparedSwap>` envelope and MUST be opened
	 * by the pinned extro-node verifier before any Ark contract is constructed.
	 */
	prepare(envelope: Uint8Array): Promise<Uint8Array>;
	/**
	 * Submit the rkyv `InitiateRequest` envelope (built off-thread by the prover)
	 * to `POST /v1/swap/initiate`. Returns the referee-assigned swap id + phase.
	 */
	initiate(envelope: Uint8Array): Promise<InitiateResult>;
	/** Advance the swap one step; returns the new phase + terminality. */
	advance(swapId: string): Promise<AdvanceResult>;
	/** Post the signed bearer-seller ack (its `swap_id` names the swap). */
	ack(ack: WalletAck): Promise<{ swap_id: string; verdict: string }>;
	audit(swapId: string): Promise<AuditEntry[]>;
}

// ── HTTP referee (extro-node's client, ADR-0007 H3) ──────────────────────────
//
// The requests are built, sent (through the node's fetch) and strictly parsed
// by extro-node (`Op::Exchange Referee`, pinned by
// `@extro/node/vectors/referee_client.json`). The pinned referee key is
// required: every call fails closed without it, and `/v1/pubkey` refuses a
// referee whose key differs.

export interface HttpRefereeOptions {
	/** Referee base URL, e.g. `https://referee.webycash.example`. */
	baseUrl: string;
	/** Pinned referee ed25519 pubkey (32-byte lower-case hex). */
	pinnedPubkeyHex: string;
	/** The node's `send`; defaults to the app's extro client. */
	send?: ExtroSend;
}

type Reply<K extends RefereeReply['reply']> = Extract<RefereeReply, { reply: K }>;

export class HttpRefereeClient implements RefereeClient {
	readonly mode = 'http' as const;
	private readonly opts: HttpRefereeOptions;

	constructor(opts: HttpRefereeOptions) {
		this.opts = opts;
	}

	private async call<K extends RefereeReply['reply']>(call: RefereeCall, want: K): Promise<Reply<K>> {
		const send = this.opts.send ?? getExtroClient().send;
		const r = await send({
			request_id: newRequestId(),
			op: {
				kind: 'Exchange',
				cmd: { op: 'Referee', base_url: this.opts.baseUrl, pinned_vk_hex: this.opts.pinnedPubkeyHex, call }
			}
		});
		if (r.kind === 'Err') throw new Error(r.message);
		if (r.body.kind !== 'ExchangeReferee' || r.body.reply.reply !== want) {
			throw new Error(`referee ${call.call}: unexpected ${r.body.kind}`);
		}
		return r.body.reply as Reply<K>;
	}

	async health(): Promise<RefereeHealth> {
		const { status, version } = await this.call({ call: 'Health' }, 'Health');
		return { status, version };
	}

	async pubkey(): Promise<RefereePubkey> {
		const p = await this.call({ call: 'Pubkey' }, 'Pubkey');
		return {
			ed25519_pubkey_hex: p.ed25519_pubkey_hex,
			musig2_pubshare_hex: p.musig2_pubshare_hex,
			referee_version: p.referee_version,
			...(p.capabilities ? { capabilities: p.capabilities } : {})
		};
	}

	async prepare(envelope: Uint8Array): Promise<Uint8Array> {
		return (await this.call({ call: 'Prepare', envelope: envelope.slice() }, 'Prepared')).signed;
	}

	async advance(swapId: string): Promise<AdvanceResult> {
		const r = await this.call({ call: 'Advance', swap_id: swapId }, 'Advanced');
		return { swapId: r.swap_id, phase: r.phase, terminal: r.terminal };
	}

	async ack(ack: WalletAck): Promise<{ swap_id: string; verdict: string }> {
		const { swap_id, verdict } = await this.call({ call: 'Ack', ack }, 'Acked');
		return { swap_id, verdict };
	}

	async audit(swapId: string): Promise<AuditEntry[]> {
		return (await this.call({ call: 'Audit', swap_id: swapId }, 'Audit')).entries;
	}

	/**
	 * POST the rkyv `InitiateRequest` envelope (built off-thread by the prover)
	 * as `application/octet-stream`. The referee verifies both Groth16 proofs +
	 * its binding gate and replies with the assigned `{swap_id, phase}`.
	 */
	async initiate(envelope: Uint8Array): Promise<InitiateResult> {
		const { swap_id, phase } = await this.call({ call: 'Initiate', envelope: envelope.slice() }, 'Initiated');
		return { swap_id, phase };
	}
}
