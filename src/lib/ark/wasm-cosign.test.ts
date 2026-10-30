import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('$lib/extro', () => ({ getExtroClient: () => ({ send }) }));

import { providerFillId, WasmProviderCosignBackend, wasmProviderPartialSign } from './wasm-cosign';
import { buildRefundTemplate, buildSettleTemplate, setDedicatedCosignBackend, signRefundRecovery, signSettlePartial } from './swap-spend';
import { fixturePlan } from './blocker3-fixture';

const RECOVERY_X = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const locked = `${'22'.repeat(32)}:1`;
const opts = {
	fillId: providerFillId('0a'.repeat(16), '0b'.repeat(20)),
	refereePkHex: '02' + '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
	refereeSettleNonceHex: '02'.repeat(66)
};

beforeEach(() => {
	send.mockReset();
	setDedicatedCosignBackend(null);
});

describe('WASM-backed Ark cosigner (blocker 3)', () => {
	it('fill id matches extro-node provider_fill_id', () => {
		expect(providerFillId('0A'.repeat(16), '0B'.repeat(20))).toBe(`${'0a'.repeat(16)}:${'0b'.repeat(20)}`);
		expect(() => providerFillId('0a', '0b'.repeat(20))).toThrow();
	});

	it('settle → ProviderPartialSign(settle) over the exact template digest', async () => {
		const tpl = await buildSettleTemplate(fixturePlan(), locked);
		send.mockResolvedValue({ kind: 'Ok', body: { kind: 'ProviderPartial', partial_hex: '5a'.repeat(32) } });
		setDedicatedCosignBackend(new WasmProviderCosignBackend(opts));
		const r = await signSettlePartial(tpl);
		expect(r.signatureHex).toBe('5a'.repeat(32));
		const cmd = send.mock.calls[0][0].op;
		expect(cmd.kind).toBe('Scheme402');
		expect(cmd.cmd.op).toBe('ProviderPartialSign');
		expect(cmd.cmd.session).toBe('settle');
		expect(cmd.cmd.fill_id).toBe(opts.fillId);
		expect(Buffer.from(cmd.cmd.msg).toString('hex')).toBe(tpl.templateDigestHex);
	});

	it('settle propagates WASM lock/scope refusals (fail closed)', async () => {
		send.mockResolvedValue({ kind: 'Err', code: 'WalletLocked', message: 'wallet locked' });
		await expect(
			wasmProviderPartialSign({ ...opts, session: 'settle', refereeNonceHex: opts.refereeSettleNonceHex, msg: new Uint8Array(32) })
		).rejects.toThrow(/wallet locked/);
		send.mockResolvedValue({ kind: 'Err', code: 'PermissionDenied', message: 'scope WalletSign(Ark) required' });
		const tpl = await buildSettleTemplate(fixturePlan(), locked);
		await expect(new WasmProviderCosignBackend(opts).signSettle(tpl)).rejects.toThrow(/WalletSign/);
	});

	it('refuses a malformed partial', async () => {
		send.mockResolvedValue({ kind: 'Ok', body: { kind: 'ProviderPartial', partial_hex: 'zz' } });
		const tpl = await buildSettleTemplate(fixturePlan(), locked);
		await expect(new WasmProviderCosignBackend(opts).signSettle(tpl)).rejects.toThrow(/malformed/);
	});

	it('refund signs with ArkSchnorrSign only when the recovery key is this wallet', async () => {
		const tpl = await buildRefundTemplate(fixturePlan(), locked);
		send.mockImplementation(async (req: { op: { cmd: { op: string } } }) =>
			req.op.cmd.op === 'ArkPublicKey'
				? { kind: 'Ok', body: { kind: 'ArkPublicKey', compressed_hex: '02' + RECOVERY_X, xonly_hex: RECOVERY_X } }
				: { kind: 'Ok', body: { kind: 'ArkSchnorrSignature', signature_hex: '7c'.repeat(64), xonly_hex: RECOVERY_X } }
		);
		setDedicatedCosignBackend(new WasmProviderCosignBackend(opts));
		const r = await signRefundRecovery(tpl);
		expect(r.signatureHex).toBe('7c'.repeat(64));
		const signCall = send.mock.calls.find((c) => c[0].op.cmd.op === 'ArkSchnorrSign');
		expect(Buffer.from(signCall![0].op.cmd.digest).toString('hex')).toBe(tpl.templateDigestHex);
	});

	it('refund refuses when the recovery key belongs to someone else', async () => {
		const tpl = await buildRefundTemplate(fixturePlan(), locked);
		const other = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
		send.mockResolvedValue({ kind: 'Ok', body: { kind: 'ArkPublicKey', compressed_hex: '02' + other, xonly_hex: other } });
		await expect(new WasmProviderCosignBackend(opts).signRefund(tpl)).rejects.toThrow(/refusing to sign/);
		expect(send.mock.calls.some((c) => c[0].op.cmd.op === 'ArkSchnorrSign')).toBe(false);
	});

	it('leaf mismatch is rejected before any WASM call', async () => {
		const settle = await buildSettleTemplate(fixturePlan(), locked);
		const refund = await buildRefundTemplate(fixturePlan(), locked);
		const b = new WasmProviderCosignBackend(opts);
		await expect(b.signSettle(refund)).rejects.toThrow();
		await expect(b.signRefund(settle)).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});
});
