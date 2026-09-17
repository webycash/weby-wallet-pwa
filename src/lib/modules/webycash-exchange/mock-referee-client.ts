// Test-only scripted referee. Production modules never import this file.

import type {
	AdvanceResult,
	AuditEntry,
	InitiateResult,
	RefereeClient,
	RefereeHealth,
	RefereePubkey,
	WalletAck
} from './referee-client';
import type { TradePhase } from './types';

export interface MockRefereeScript {
	[swapId: string]: TradePhase[];
}

export class MockRefereeClient implements RefereeClient {
	readonly mode = 'mock' as const;
	private readonly cursor = new Map<string, number>();
	private readonly auditLog = new Map<string, AuditEntry[]>();

	constructor(
		private readonly script: MockRefereeScript = {},
		private readonly now: () => number = () => Math.floor(Date.now() / 1000)
	) {}

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

	async prepare(_envelope: Uint8Array): Promise<Uint8Array> {
		throw new Error('mock referee cannot produce a cryptographically signed prepare allocation');
	}

	async initiate(envelope: Uint8Array): Promise<InitiateResult> {
		const tag = envelope.length
			? `${envelope.length}-${envelope[0]}-${envelope[envelope.length - 1]}`
			: '0';
		return { swap_id: `mock-${tag}`, phase: 'request-sent' };
	}

	async advance(swapId: string): Promise<AdvanceResult> {
		const phases = this.script[swapId] ?? ['settled'];
		const index = this.cursor.get(swapId) ?? 0;
		const phase = phases[Math.min(index, phases.length - 1)];
		const terminal = index >= phases.length - 1;
		this.cursor.set(swapId, Math.min(index + 1, phases.length - 1));
		const entry: AuditEntry = {
			swap_id: swapId,
			phase,
			at: this.now(),
			note: `advance → ${phase}`
		};
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
