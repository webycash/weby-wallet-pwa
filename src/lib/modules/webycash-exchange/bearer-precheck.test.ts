import { describe, expect, it, vi } from 'vitest';
import {
	assertBearerLegIssued,
	awaitRefereePrecheck,
	railTokenStatus,
	submitBearerPrecheck,
	webcashUnits
} from './bearer-precheck';

const H = `e100:public:${'ab'.repeat(32)}`;
const rail = (row: unknown) =>
	vi.fn(async () => new Response(JSON.stringify({ status: 'success', results: row === undefined ? {} : { [H]: row } })));

describe('railTokenStatus (webcash.org health_check)', () => {
	it('spent:null is UNKNOWN (never issued) — not unspent, not spent', async () => {
		expect(await railTokenStatus('https://webcash.org', H, rail({ spent: null, amount: null }) as never)).toEqual({ status: 'unknown' });
		expect(await railTokenStatus('https://webcash.org', H, rail(undefined) as never)).toEqual({ status: 'unknown' });
	});
	it('spent:false is unspent with amount; spent:true is spent', async () => {
		expect(await railTokenStatus('https://webcash.org/', H, rail({ spent: false, amount: '100' }) as never)).toEqual({ status: 'unspent', amount: '100' });
		expect((await railTokenStatus('https://webcash.org', H, rail({ spent: true, amount: '100' }) as never)).status).toBe('spent');
	});
	it('posts the exact public token to /api/v1/health_check and refuses secrets', async () => {
		const f = rail({ spent: false, amount: '100' });
		await railTokenStatus('https://webcash.org/', H, f as never);
		expect(f).toHaveBeenCalledWith('https://webcash.org/api/v1/health_check', expect.objectContaining({ method: 'POST', body: JSON.stringify([H]) }));
		await expect(railTokenStatus('https://webcash.org', `e1:secret:${'00'.repeat(32)}`, f as never)).rejects.toThrow(/public/);
	});
	it('sends a CORS-simple request (no JSON content-type: webcash.org preflight allows only x-requested-with)', async () => {
		const f = rail({ spent: false, amount: '100' });
		await railTokenStatus('https://webcash.org', H, f as never);
		const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
		const h = new Headers(init.headers);
		expect(h.has('content-type')).toBe(false);
		expect(typeof init.body).toBe('string');
	});
});

describe('assertBearerLegIssued', () => {
	it('names BEARER_LEG_NOT_ISSUED for spent:null, UNUSABLE for spent/short', async () => {
		await expect(assertBearerLegIssued({ railBase: 'x', publicWebcash: H, fillAmount: '100', fetchFn: rail({ spent: null }) as never })).rejects.toThrow(/^BEARER_LEG_NOT_ISSUED/);
		await expect(assertBearerLegIssued({ railBase: 'x', publicWebcash: H, fillAmount: '100', fetchFn: rail({ spent: true, amount: '100' }) as never })).rejects.toThrow(/^BEARER_LEG_UNUSABLE.*spent/);
		await expect(assertBearerLegIssued({ railBase: 'x', publicWebcash: H, fillAmount: '100', fetchFn: rail({ spent: false, amount: '99.99999999' }) as never })).rejects.toThrow(/^BEARER_LEG_UNUSABLE.*face/);
	});
	it('passes for a live token covering the fill', async () => {
		expect(await assertBearerLegIssued({ railBase: 'x', publicWebcash: H, fillAmount: '100', fetchFn: rail({ spent: false, amount: '100' }) as never })).toEqual({ amount: '100' });
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
