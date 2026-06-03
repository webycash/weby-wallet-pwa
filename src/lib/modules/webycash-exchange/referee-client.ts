// Webycash referee client.
//
// Targets the referee REST shapes (webycash/webycash-referee/src/api/router.rs):
//
//   GET  /v1/health
//   GET  /v1/pubkey
//   POST /v1/swap/initiate         (currently a 400 STUB — wire envelope not final)
//   POST /v1/swap/:id/advance
//   POST /v1/swap/:id/ack
//   GET  /v1/swap/:id/audit
//   GET  /v1/party/:fp/swaps
//
// The module does NOT implement the referee state machine — it only calls it,
// and treats the referee as a MEDIATOR, never as custody (per the security
// invariants). The DEFAULT adapter is a MOCK so dev/tests need no live referee;
// the real HTTP adapter targets the routes above. `initiate` is a known 400
// stub today, so the real adapter's initiate is explicitly deferred.

import type { TradePhase } from './types';

/** A redaction-safe audit entry as served by GET /v1/swap/:id/audit. */
export interface AuditEntry {
	swap_id: string;
	phase: string;
	at: number;
	note: string;
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
}

/** A signed wallet ack POSTed to /v1/swap/:id/ack. Never carries a secret. */
export interface WalletAck {
	swap_id: string;
	/** Push kind, e.g. `"Invalidate"`. */
	kind: string;
	outcome: string;
}

export interface RefereeClient {
	readonly mode: 'mock' | 'http';
	health(): Promise<RefereeHealth>;
	pubkey(): Promise<RefereePubkey>;
	/** Advance the swap one step; returns the new phase + terminality. */
	advance(swapId: string): Promise<AdvanceResult>;
	/** Post a signed wallet ack. */
	ack(swapId: string, ack: WalletAck): Promise<{ swap_id: string; verdict: string }>;
	audit(swapId: string): Promise<AuditEntry[]>;
}

// ── Mock referee (default) ────────────────────────────────────────────────────

/**
 * Scripted referee for dev/tests. The `script` maps a swap id to the ordered
 * sequence of phases the referee will report on successive `advance` calls. The
 * last phase in a script is treated as terminal.
 */
export interface MockRefereeScript {
	[swapId: string]: TradePhase[];
}

export class MockRefereeClient implements RefereeClient {
	readonly mode = 'mock' as const;
	private readonly script: MockRefereeScript;
	private readonly cursor = new Map<string, number>();
	private readonly auditLog = new Map<string, AuditEntry[]>();
	private now: () => number;

	constructor(script: MockRefereeScript = {}, now: () => number = () => Math.floor(Date.now() / 1000)) {
		this.script = script;
		this.now = now;
	}

	async health(): Promise<RefereeHealth> {
		return { status: 'ok', version: 'mock' };
	}

	async pubkey(): Promise<RefereePubkey> {
		return {
			ed25519_pubkey_hex: '00'.repeat(32),
			musig2_pubshare_hex: '00'.repeat(33),
			referee_version: 'mock'
		};
	}

	async advance(swapId: string): Promise<AdvanceResult> {
		const phases = this.script[swapId] ?? ['settled'];
		const i = this.cursor.get(swapId) ?? 0;
		const phase = phases[Math.min(i, phases.length - 1)];
		const terminal = i >= phases.length - 1;
		this.cursor.set(swapId, Math.min(i + 1, phases.length - 1));
		const entry: AuditEntry = { swap_id: swapId, phase, at: this.now(), note: `advance → ${phase}` };
		this.auditLog.set(swapId, [...(this.auditLog.get(swapId) ?? []), entry]);
		return { swapId, phase, terminal };
	}

	async ack(swapId: string, ack: WalletAck): Promise<{ swap_id: string; verdict: string }> {
		return { swap_id: swapId, verdict: `Acked(${ack.outcome})` };
	}

	async audit(swapId: string): Promise<AuditEntry[]> {
		return this.auditLog.get(swapId) ?? [];
	}
}

// ── HTTP referee (targets the real routes) ────────────────────────────────────

export interface HttpRefereeOptions {
	/** Referee base URL, e.g. `https://referee.webycash.example`. */
	baseUrl: string;
	/** Pinned referee ed25519 pubkey (hex) — verified before trusting messages. */
	pinnedPubkeyHex?: string;
	fetchFn?: typeof fetch;
}

export class HttpRefereeClient implements RefereeClient {
	readonly mode = 'http' as const;
	private readonly opts: HttpRefereeOptions;

	constructor(opts: HttpRefereeOptions) {
		this.opts = opts;
	}

	private get f(): typeof fetch {
		return this.opts.fetchFn ?? fetch;
	}

	private url(path: string): string {
		return `${this.opts.baseUrl.replace(/\/$/, '')}${path}`;
	}

	async health(): Promise<RefereeHealth> {
		const r = await this.f(this.url('/v1/health'));
		return (await r.json()) as RefereeHealth;
	}

	async pubkey(): Promise<RefereePubkey> {
		const r = await this.f(this.url('/v1/pubkey'));
		const body = (await r.json()) as RefereePubkey;
		if (this.opts.pinnedPubkeyHex && body.ed25519_pubkey_hex !== this.opts.pinnedPubkeyHex) {
			throw new Error('referee pubkey does not match the pinned key — refusing to trust');
		}
		return body;
	}

	async advance(swapId: string): Promise<AdvanceResult> {
		const r = await this.f(this.url(`/v1/swap/${encodeURIComponent(swapId)}/advance`), {
			method: 'POST'
		});
		const body = (await r.json()) as { swap_id: string; phase: string; terminal: boolean };
		return { swapId: body.swap_id, phase: body.phase, terminal: body.terminal };
	}

	async ack(swapId: string, ack: WalletAck): Promise<{ swap_id: string; verdict: string }> {
		const r = await this.f(this.url(`/v1/swap/${encodeURIComponent(swapId)}/ack`), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(ack)
		});
		return (await r.json()) as { swap_id: string; verdict: string };
	}

	async audit(swapId: string): Promise<AuditEntry[]> {
		const r = await this.f(this.url(`/v1/swap/${encodeURIComponent(swapId)}/audit`));
		return (await r.json()) as AuditEntry[];
	}

	/**
	 * DEFERRED: `POST /v1/swap/initiate` is a 400 stub today (the signed wire
	 * envelope is not finalized). Calling it returns the stub's structured 400.
	 * Real initiation is driven via the orchestrator/tests for now.
	 */
	async initiate(): Promise<never> {
		throw new Error(
			'referee /v1/swap/initiate is a 400 stub (signed wire envelope not finalized). ' +
				'Initiation is deferred until the envelope lands.'
		);
	}
}
