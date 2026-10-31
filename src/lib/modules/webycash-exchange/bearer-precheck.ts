/**
 * Pre-funding checks. Nothing here mints, mines or replaces webcash.
 *
 * - `railTokenStatus`: tri-state rail `health_check` read, via extro-node
 *   (`Rail(WebcashTokenStatus)`, webylib wire). webcash.org answers `spent:null` for a token it has never seen; that is
 *   NOT "unspent" and NOT "already spent" — it means the leg was never issued.
 * - `assertBearerLegIssued`: the taker's H must be a live, unspent token whose
 *   face amount covers the order fill.
 * - `awaitRefereePrecheck`: the maker funds only after the referee attests a
 *   passing pre-check for both legs (`precheck-v1`). Older referees without
 *   the capability fail closed (named gate) — the maker never funds blind.
 */
import {
	GATE_BEARER_LEG_NOT_ISSUED,
	GATE_BEARER_LEG_UNUSABLE,
	GATE_REFEREE_PRECHECK_PENDING
} from '$lib/ark/named-gates';
import {
	ExtroWebcashRailClient,
	type RailTokenStatus,
	type WebcashTokenStatusOp
} from '$lib/core/webcash-rail-client';

export type { RailTokenStatus, WebcashTokenStatusOp };

type FetchFn = typeof fetch;

/** Tri-state rail read of one public token, via the shared webcash-rail client. */
export async function railTokenStatus(
	railBase: string,
	publicWebcash: string,
	tokenStatus?: WebcashTokenStatusOp
): Promise<RailTokenStatus> {
	const rail = new ExtroWebcashRailClient({ baseUrl: railBase, tokenStatus });
	return (await rail.healthCheck([publicWebcash]))[publicWebcash];
}

/** Decimal webcash amount string → 1e-8 units (exact; no float). */
export function webcashUnits(amount: string): bigint {
	const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(amount.trim());
	if (!m) throw new Error(`bad webcash amount ${amount}`);
	return BigInt(m[1]) * 100_000_000n + BigInt((m[2] ?? '').padEnd(8, '0'));
}

export async function assertBearerLegIssued(input: {
	railBase: string;
	publicWebcash: string;
	/** Fill amount in the same decimal webcash units as the token face (e.g. "0.5"). */
	fillAmount: string;
	tokenStatus?: WebcashTokenStatusOp;
}): Promise<{ amount: string }> {
	const st = await railTokenStatus(input.railBase, input.publicWebcash, input.tokenStatus);
	if (st.status === 'unknown') throw new Error(GATE_BEARER_LEG_NOT_ISSUED);
	if (st.status === 'spent') throw new Error(`${GATE_BEARER_LEG_UNUSABLE} (spent)`);
	const face = st.amount ?? input.publicWebcash.slice(1, input.publicWebcash.indexOf(':'));
	if (webcashUnits(face) < webcashUnits(input.fillAmount)) {
		throw new Error(`${GATE_BEARER_LEG_UNUSABLE} (face ${face} < fill ${input.fillAmount})`);
	}
	return { amount: face };
}

export const REFEREE_PRECHECK_CAPABILITY = 'precheck-v1';

export type RefereePrecheck = {
	swap_id: string;
	bearer: { ok: boolean; reason?: string };
	provider: { ok: boolean; reason?: string };
};

/**
 * Poll the referee pre-check for `swapId` until both legs pass. Throws the
 * named gate (never resolves "ok") when the referee lacks `precheck-v1`, a leg
 * fails, or the wait times out. Callers must not fund unless this resolves.
 */
export async function awaitRefereePrecheck(input: {
	refereeUrl: string;
	swapId: string;
	capabilities: string[] | undefined;
	timeoutMs?: number;
	intervalMs?: number;
	fetchFn?: FetchFn;
}): Promise<RefereePrecheck> {
	const fetchFn = input.fetchFn ?? fetch;
	if (!input.capabilities?.includes(REFEREE_PRECHECK_CAPABILITY)) {
		throw new Error(`${GATE_REFEREE_PRECHECK_PENDING} (referee lacks ${REFEREE_PRECHECK_CAPABILITY})`);
	}
	const base = input.refereeUrl.replace(/\/+$/, '');
	const deadline = Date.now() + (input.timeoutMs ?? 120_000);
	let last = 'no response';
	for (;;) {
		const r = await fetchFn(`${base}/v1/swap/${encodeURIComponent(input.swapId)}/precheck`);
		if (r.ok) {
			const p = (await r.json()) as RefereePrecheck;
			if (p.swap_id === input.swapId && p.bearer?.ok === true && p.provider?.ok === true) return p;
			if (p.bearer?.ok === false && p.bearer.reason) {
				throw new Error(`${GATE_REFEREE_PRECHECK_PENDING} (bearer: ${p.bearer.reason})`);
			}
			last = `bearer=${p.bearer?.ok} provider=${p.provider?.ok}`;
		} else {
			last = `HTTP ${r.status}`;
		}
		if (Date.now() >= deadline) throw new Error(`${GATE_REFEREE_PRECHECK_PENDING} (${last})`);
		await new Promise((res) => setTimeout(res, input.intervalMs ?? 1_000));
	}
}

/** Taker: ask the referee to record its own rail check of the bearer leg for `swapId`. */
export async function submitBearerPrecheck(input: {
	refereeUrl: string;
	swapId: string;
	publicWebcash: string;
	capabilities: string[] | undefined;
	fetchFn?: FetchFn;
}): Promise<void> {
	if (!input.capabilities?.includes(REFEREE_PRECHECK_CAPABILITY)) {
		throw new Error(`${GATE_REFEREE_PRECHECK_PENDING} (referee lacks ${REFEREE_PRECHECK_CAPABILITY})`);
	}
	const fetchFn = input.fetchFn ?? fetch;
	const base = input.refereeUrl.replace(/\/+$/, '');
	const r = await fetchFn(`${base}/v1/swap/${encodeURIComponent(input.swapId)}/precheck`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ public_webcash: input.publicWebcash })
	});
	if (!r.ok) {
		throw new Error(`${GATE_REFEREE_PRECHECK_PENDING} (submit HTTP ${r.status}: ${(await r.text()).slice(0, 160)})`);
	}
}
