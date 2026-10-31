import { describe, expect, it, vi } from 'vitest';
import {
	assertBearerLegIssued,
	awaitRefereePrecheck,
	railTokenStatus,
	submitBearerPrecheck,
	webcashUnits
} from './bearer-precheck';

const H = `e100:public:${'ab'.repeat(32)}`;
const W = 'https://webcash.org';
type Row = { status: 'unknown' | 'unspent' | 'spent'; amount: string | null };
/** Stub of the extro-node `Rail(WebcashTokenStatus)` op (the only rail path in TS). */
const op = (row: Row) =>
	vi.fn(async (a: { serverUrl: string; publicTokens: string[] }) => ({
		state: 'ok' as const,
		value: {
			kind: 'WebcashTokenStatuses' as const,
			statuses: a.publicTokens.map((public_token) => ({ public_token, ...row }))
		}
	}));

describe('railTokenStatus (rail health_check via extro-node)', () => {
	it('unknown (spent:null, never issued) is neither unspent nor spent', async () => {
		expect(await railTokenStatus(W, H, op({ status: 'unknown', amount: null }))).toEqual({ status: 'unknown' });
	});
	it('unspent carries the amount; spent is spent', async () => {
		expect(await railTokenStatus(`${W}/`, H, op({ status: 'unspent', amount: '100' }))).toEqual({ status: 'unspent', amount: '100' });
		expect((await railTokenStatus(W, H, op({ status: 'spent', amount: '100' }))).status).toBe('spent');
	});
	it('dispatches the exact public token + normalized base and refuses secrets', async () => {
		const f = op({ status: 'unspent', amount: '100' });
		await railTokenStatus(`${W}/`, H, f);
		expect(f).toHaveBeenCalledWith({ serverUrl: W, publicTokens: [H] });
		await expect(railTokenStatus(W, `e1:secret:${'00'.repeat(32)}`, f)).rejects.toThrow(/public/);
		expect(f).toHaveBeenCalledTimes(1);
	});
	it('fails closed on node errors, unsupported builds and mismatched rows', async () => {
		await expect(railTokenStatus(W, H, async () => ({ state: 'error', message: 'boom' }))).rejects.toThrow(/node: boom/);
		await expect(railTokenStatus(W, H, async () => ({ state: 'pending' }))).rejects.toThrow(/unsupported/);
		const wrong = async () => ({
			state: 'ok' as const,
			value: {
				kind: 'WebcashTokenStatuses' as const,
				statuses: [{ public_token: `e100:public:${'cd'.repeat(32)}`, status: 'unspent' as const, amount: '100' }]
			}
		});
		await expect(railTokenStatus(W, H, wrong)).rejects.toThrow(/bad_response/);
		const none = async () => ({ state: 'ok' as const, value: { kind: 'WebcashTokenStatuses' as const, statuses: [] } });
		await expect(railTokenStatus(W, H, none)).rejects.toThrow(/bad_response/);
	});
});

describe('assertBearerLegIssued', () => {
	it('names BEARER_LEG_NOT_ISSUED for unknown, UNUSABLE for spent/short', async () => {
		await expect(assertBearerLegIssued({ railBase: W, publicWebcash: H, fillAmount: '100', tokenStatus: op({ status: 'unknown', amount: null }) })).rejects.toThrow(/^BEARER_LEG_NOT_ISSUED/);
		await expect(assertBearerLegIssued({ railBase: W, publicWebcash: H, fillAmount: '100', tokenStatus: op({ status: 'spent', amount: '100' }) })).rejects.toThrow(/^BEARER_LEG_UNUSABLE.*spent/);
		await expect(assertBearerLegIssued({ railBase: W, publicWebcash: H, fillAmount: '100', tokenStatus: op({ status: 'unspent', amount: '99.99999999' }) })).rejects.toThrow(/^BEARER_LEG_UNUSABLE.*face/);
	});
	it('passes for a live token covering the fill', async () => {
		expect(await assertBearerLegIssued({ railBase: W, publicWebcash: H, fillAmount: '100', tokenStatus: op({ status: 'unspent', amount: '100' }) })).toEqual({ amount: '100' });
	});
	it('webcashUnits is exact', () => {
		expect(webcashUnits('0.00000001')).toBe(1n);
		expect(webcashUnits('100')).toBe(10_000_000_000n);
		expect(() => webcashUnits('1e3')).toThrow();
	});
});

describe('referee pre-check gate', () => {
	it('fails closed when the referee lacks precheck-v1 (no request made)', async () => {
		const f = vi.fn();
		await expect(awaitRefereePrecheck({ refereeUrl: 'https://r', swapId: 's', capabilities: ['settle-ceremony-v1'], fetchFn: f as never })).rejects.toThrow(/^REFEREE_PRECHECK_PENDING.*precheck-v1/);
		await expect(submitBearerPrecheck({ refereeUrl: 'https://r', swapId: 's', publicWebcash: H, capabilities: undefined, fetchFn: f as never })).rejects.toThrow(/^REFEREE_PRECHECK_PENDING/);
		expect(f).not.toHaveBeenCalled();
	});
	it('resolves only when BOTH legs are ok for this swap id', async () => {
		const seq = [
			{ swap_id: 's', bearer: { ok: true }, provider: { ok: false } },
			{ swap_id: 'other', bearer: { ok: true }, provider: { ok: true } },
			{ swap_id: 's', bearer: { ok: true }, provider: { ok: true } }
		];
		const f = vi.fn(async () => new Response(JSON.stringify(seq.shift())));
		const p = await awaitRefereePrecheck({ refereeUrl: 'https://r/', swapId: 's', capabilities: ['precheck-v1'], intervalMs: 1, fetchFn: f as never });
		expect(p.provider.ok).toBe(true);
		expect(f).toHaveBeenCalledTimes(3);
		expect(f).toHaveBeenCalledWith('https://r/v1/swap/s/precheck');
	});
	it('a failed bearer leg or a timeout is a gate, never ok', async () => {
		const bad = vi.fn(async () => new Response(JSON.stringify({ swap_id: 's', bearer: { ok: false, reason: 'H unknown to rail (spent:null)' }, provider: { ok: true } })));
		await expect(awaitRefereePrecheck({ refereeUrl: 'https://r', swapId: 's', capabilities: ['precheck-v1'], fetchFn: bad as never })).rejects.toThrow(/bearer: H unknown/);
		const nf = vi.fn(async () => new Response('nope', { status: 404 }));
		await expect(awaitRefereePrecheck({ refereeUrl: 'https://r', swapId: 's', capabilities: ['precheck-v1'], timeoutMs: 5, intervalMs: 1, fetchFn: nf as never })).rejects.toThrow(/^REFEREE_PRECHECK_PENDING.*\(HTTP 404\)$/);
	});
});
