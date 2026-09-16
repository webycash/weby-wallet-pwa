/**
 * In-app prepare-terms draft bus for Accept→runSwap dual-signing.
 *
 * The taker publishes byte-exact ArkPrepareTerms after building them from
 * ProviderMaterial; the maker polls and calls providerSignAndRelayPrepare.
 * Also mirrors onto window.__webyPrepareTermsDraft (and __gate5TermsDraft for
 * harness compat). This is NOT a network transport — cross-browser makers must
 * either share this bus via the test harness or rebuild deterministic terms.
 */

import type { ArkPrepareTerms } from '$lib/extro/commands';

export type PrepareTermsDraftWire = {
	order_id: string;
	signed_order_commitment_sha256: string;
	fill_amount_raw: string;
	parties: ArkPrepareTerms['parties'];
	provider_nonces: ArkPrepareTerms['provider_nonces'];
	ark_network: ArkPrepareTerms['ark_network'];
	ark_operator_signer_pk: string;
	ark_operator_info_digest: string;
	ark_unilateral_exit_delay: string;
	ark_amount_sats: string;
	provider_ark_destination: string;
	bearer_seller_ark_destination: string;
	idempotency_key: string;
	nonce: string;
	expires_at_unix: number;
};

const drafts = new Map<string, PrepareTermsDraftWire>();
const providerDone = new Set<string>();

const bytesToHex = (b: Uint8Array): string =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex: string): Uint8Array => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0) throw new Error('hex length must be even');
	return Uint8Array.from({ length: clean.length / 2 }, (_, i) =>
		Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	);
};

export function serializePrepareTermsDraft(terms: ArkPrepareTerms): PrepareTermsDraftWire {
	return {
		order_id: bytesToHex(terms.order_id),
		signed_order_commitment_sha256: bytesToHex(terms.signed_order_commitment_sha256),
		fill_amount_raw: terms.fill_amount_raw.toString(),
		parties: terms.parties,
		provider_nonces: terms.provider_nonces,
		ark_network: terms.ark_network,
		ark_operator_signer_pk: bytesToHex(terms.ark_operator_signer_pk),
		ark_operator_info_digest: bytesToHex(terms.ark_operator_info_digest),
		ark_unilateral_exit_delay: terms.ark_unilateral_exit_delay.toString(),
		ark_amount_sats: terms.ark_amount_sats.toString(),
		provider_ark_destination: terms.provider_ark_destination,
		bearer_seller_ark_destination: terms.bearer_seller_ark_destination,
		idempotency_key: bytesToHex(terms.idempotency_key),
		nonce: bytesToHex(terms.nonce),
		expires_at_unix: terms.expires_at_unix
	};
}

export function parsePrepareTermsDraft(draft: PrepareTermsDraftWire): ArkPrepareTerms {
	return {
		order_id: hexToBytes(draft.order_id),
		signed_order_commitment_sha256: hexToBytes(draft.signed_order_commitment_sha256),
		fill_amount_raw: BigInt(draft.fill_amount_raw),
		parties: draft.parties,
		provider_nonces: draft.provider_nonces,
		ark_network: draft.ark_network,
		ark_operator_signer_pk: hexToBytes(draft.ark_operator_signer_pk),
		ark_operator_info_digest: hexToBytes(draft.ark_operator_info_digest),
		ark_unilateral_exit_delay: BigInt(draft.ark_unilateral_exit_delay),
		ark_amount_sats: BigInt(draft.ark_amount_sats),
		provider_ark_destination: draft.provider_ark_destination,
		bearer_seller_ark_destination: draft.bearer_seller_ark_destination,
		idempotency_key: hexToBytes(draft.idempotency_key),
		nonce: hexToBytes(draft.nonce),
		expires_at_unix: draft.expires_at_unix
	};
}

function mirrorToWindow(draft: PrepareTermsDraftWire | null): void {
	if (typeof window === 'undefined') return;
	const w = window as unknown as {
		__webyPrepareTermsDraft?: PrepareTermsDraftWire | null;
		__gate5TermsDraft?: PrepareTermsDraftWire | null;
	};
	w.__webyPrepareTermsDraft = draft;
	w.__gate5TermsDraft = draft;
}

/** Publish taker-built terms for the maker to sign (in-process / harness). */
export function publishPrepareTermsDraft(orderIdHex: string, terms: ArkPrepareTerms): void {
	const wire = serializePrepareTermsDraft(terms);
	drafts.set(orderIdHex.toLowerCase(), wire);
	providerDone.delete(orderIdHex.toLowerCase());
	mirrorToWindow(wire);
}

export function getPrepareTermsDraft(orderIdHex: string): PrepareTermsDraftWire | null {
	const key = orderIdHex.toLowerCase();
	if (drafts.has(key)) return drafts.get(key)!;
	if (typeof window !== 'undefined') {
		const w = window as unknown as {
			__webyPrepareTermsDraft?: PrepareTermsDraftWire;
			__gate5TermsDraft?: PrepareTermsDraftWire;
		};
		return w.__webyPrepareTermsDraft ?? w.__gate5TermsDraft ?? null;
	}
	return null;
}

export function markProviderPrepareDone(orderIdHex: string): void {
	const key = orderIdHex.toLowerCase();
	providerDone.add(key);
	if (typeof window !== 'undefined') {
		(window as unknown as { __gate5ProviderPrepareDone?: boolean }).__gate5ProviderPrepareDone =
			true;
		(window as unknown as { __webyProviderPrepareDone?: boolean }).__webyProviderPrepareDone = true;
	}
}

export function isProviderPrepareDone(orderIdHex: string): boolean {
	if (providerDone.has(orderIdHex.toLowerCase())) return true;
	if (typeof window === 'undefined') return false;
	const w = window as unknown as {
		__gate5ProviderPrepareDone?: boolean;
		__webyProviderPrepareDone?: boolean;
	};
	return !!(w.__webyProviderPrepareDone || w.__gate5ProviderPrepareDone);
}

export async function waitForProviderPrepareDone(
	orderIdHex: string,
	opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
	const timeoutMs = opts.timeoutMs ?? 60_000;
	const intervalMs = opts.intervalMs ?? 100;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (isProviderPrepareDone(orderIdHex)) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error('timed out waiting for provider to sign prepare terms');
}

export function clearPrepareTermsDraftsForTests(): void {
	drafts.clear();
	providerDone.clear();
	mirrorToWindow(null);
	if (typeof window !== 'undefined') {
		(window as unknown as { __gate5ProviderPrepareDone?: boolean }).__gate5ProviderPrepareDone =
			false;
		(window as unknown as { __webyProviderPrepareDone?: boolean }).__webyProviderPrepareDone = false;
	}
}
