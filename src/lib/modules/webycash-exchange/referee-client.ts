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
	/** Post a signed wallet ack. */
	ack(swapId: string, ack: WalletAck): Promise<{ swap_id: string; verdict: string }>;
	audit(swapId: string): Promise<AuditEntry[]>;
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
		if (!r.ok) throw new Error(`referee /v1/health ${r.status}`);
		return (await r.json()) as RefereeHealth;
	}

	async pubkey(): Promise<RefereePubkey> {
		const r = await this.f(this.url('/v1/pubkey'));
		if (!r.ok) throw new Error(`referee /v1/pubkey ${r.status}`);
		const body = (await r.json()) as RefereePubkey;
		if (this.opts.pinnedPubkeyHex && body.ed25519_pubkey_hex !== this.opts.pinnedPubkeyHex) {
			throw new Error('referee pubkey does not match the pinned key — refusing to trust');
		}
		return body;
	}

	async prepare(envelope: Uint8Array): Promise<Uint8Array> {
		const r = await this.f(this.url('/v1/swap/prepare'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: envelope.slice()
		});
		if (!r.ok) {
			const detail = await r.text().catch(() => '');
			throw new Error(`referee /v1/swap/prepare ${r.status}: ${detail || r.statusText}`);
		}
		return new Uint8Array(await r.arrayBuffer());
	}

	async advance(swapId: string): Promise<AdvanceResult> {
		const r = await this.f(this.url(`/v1/swap/${encodeURIComponent(swapId)}/advance`), {
			method: 'POST'
		});
		if (!r.ok) throw new Error(`referee advance ${r.status}`);
		const body = (await r.json()) as { swap_id: string; phase: string; terminal: boolean };
		return { swapId: body.swap_id, phase: body.phase, terminal: body.terminal };
	}

	async ack(swapId: string, ack: WalletAck): Promise<{ swap_id: string; verdict: string }> {
		const r = await this.f(this.url(`/v1/swap/${encodeURIComponent(swapId)}/ack`), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(ack)
		});
		if (!r.ok) throw new Error(`referee ack ${r.status}`);
		return (await r.json()) as { swap_id: string; verdict: string };
	}

	async audit(swapId: string): Promise<AuditEntry[]> {
		const r = await this.f(this.url(`/v1/swap/${encodeURIComponent(swapId)}/audit`));
		if (!r.ok) throw new Error(`referee audit ${r.status}`);
		return (await r.json()) as AuditEntry[];
	}

	/**
	 * POST the rkyv `InitiateRequest` envelope (built off-thread by the prover)
	 * as `application/octet-stream`. The referee verifies both Groth16 proofs +
	 * its binding gate and replies with the assigned `{swap_id, phase}`.
	 */
	async initiate(envelope: Uint8Array): Promise<InitiateResult> {
		// Copy into a tight ArrayBuffer so a subarray-backed view (e.g. the
		// worker's transferred buffer) is sent whole, not its parent buffer.
		const body = envelope.slice();
		const r = await this.f(this.url('/v1/swap/initiate'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body
		});
		if (!r.ok) {
			const detail = await r.text().catch(() => '');
			throw new Error(`referee /v1/swap/initiate ${r.status}: ${detail || r.statusText}`);
		}
		const parsed = (await r.json()) as { swap_id: string; phase: string };
		return { swap_id: parsed.swap_id, phase: parsed.phase };
	}
}
