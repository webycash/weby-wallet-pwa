/**
 * Real Ark sighash construction vs the Arkade SDK, with test-only keys:
 * MuSig2-aggregate [referee, provider] over the [checkpoint, ark] bundle and
 * check the SDK's own `verifyTapscriptSignatures` accepts the result on the
 * exact txs `signAndSubmitOffchainTx` submits.
 */
import { describe, expect, it } from 'vitest';
import { ArkAddress, CSVMultisigTapscript, Transaction, verifyTapscriptSignatures } from '@arkade-os/sdk';
import { SigHash } from '@scure/btc-signer';
import { base64 } from '@scure/base';
import {
	Session,
	IndividualPubkey,
	keyAggExport,
	keyAggregate,
	nonceAggregate,
	nonceGen
} from '@scure/btc-signer/musig2.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import type { ExtroRuntimeConfig } from '$lib/extro/release-config';
import { buildArkSwapContract, type VerifiedArkContractPlan } from './swap-contract';
import { buildArkSpend, presignedIdentity, sighashBundleBinding, submitArkSpend, tapscriptSighash } from './settle-tx';

const hx = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sk = (n: number) => {
	const k = new Uint8Array(32);
	k[31] = n;
	k[0] = 0x42; // TEST-ONLY scalars, never funded
	return k;
};
const REFEREE = sk(1);
const PROVIDER = sk(2);
const OPERATOR = sk(3);
const RECOVERY = sk(4);
const refPub = IndividualPubkey(REFEREE);
const provPub = IndividualPubkey(PROVIDER);
const Q = keyAggExport(keyAggregate([refPub, provPub]));
const OP_X = schnorr.getPublicKey(OPERATOR);

const addr = (seed: number) => new ArkAddress(OP_X, schnorr.getPublicKey(sk(seed)), 'tark').encode();
const checkpointHex = hx(
	CSVMultisigTapscript.encode({ pubkeys: [OP_X], timelock: { type: 'blocks', value: 144n } }).script
);

const plan: VerifiedArkContractPlan = {
	swapId: 'settle-tx-fixture',
	requestCommitment: Uint8Array.from({ length: 32 }, (_, i) => i + 7),
	aggregateOwnerKey: Q,
	providerRecoveryKey: schnorr.getPublicKey(RECOVERY),
	operatorSignerKey: OP_X,
	operatorInfoDigest: new Uint8Array(32).fill(0x62),
	unilateralExitDelay: 86_016n,
	amountSats: 25_000n,
	network: 'signet',
	providerDestination: addr(9),
	bearerSellerDestination: addr(8),
	expiresAtUnix: 4_000_000_000n
};
const config = {
	ark_enabled: true,
	ark_network: 'signet',
	ark_signer_pk_hex: hx(OP_X),
	ark_info_digest_hex: '62'.repeat(32),
	ark_checkpoint_tapscript_hex: checkpointHex,
	ark_unilateral_exit_delay: 86_016
} as unknown as ExtroRuntimeConfig;
const contract = buildArkSwapContract(config, plan, 1n);
const LOCKED = `${'5a'.repeat(32)}:1`;

function musigSign(msg: Uint8Array): Uint8Array {
	const rn = nonceGen(refPub, REFEREE, Q, msg);
	const pn = nonceGen(provPub, PROVIDER, Q, msg);
	const s = new Session(nonceAggregate([rn.public, pn.public]), [refPub, provPub], msg);
	return s.partialSigAgg([s.sign(rn.secret, REFEREE), s.sign(pn.secret, PROVIDER)]);
}

const spend = (kind: 'settle' | 'refund') =>
	buildArkSpend({ contract, lockedRef: LOCKED, kind, checkpointTapscriptHex: checkpointHex });

describe('Ark settle/refund tx sighashes', () => {
	it('is deterministic, distinct per path and per tx, and spends the locked VTXO', async () => {
		const a = spend('settle');
		const b = spend('settle');
		const r = spend('refund');
		expect(a.bundleHex).toBe(b.bundleHex);
		expect(a.bundleHex).toMatch(/^[0-9a-f]{128}$/);
		expect(hx(a.sighashes[0])).not.toBe(hx(a.sighashes[1]));
		expect(a.bundleHex).not.toBe(r.bundleHex);
		const cp = a.offchain.checkpoints[0].getInput(0);
		expect(hx(cp.txid!)).toBe('5a'.repeat(32));
		expect(cp.index).toBe(1);
		expect(hx(a.offchain.arkTx.getInput(0).txid!)).toBe(a.offchain.checkpoints[0].id);
		expect(hx(a.offchain.arkTx.getOutput(0).script!)).toBe(
			hx(ArkAddress.decode(plan.bearerSellerDestination).pkScript)
		);
		expect(hx(r.offchain.arkTx.getOutput(0).script!)).toBe(hx(ArkAddress.decode(plan.providerDestination).pkScript));
		const bind = await sighashBundleBinding(Uint8Array.from(Buffer.from(a.bundleHex, 'hex')));
		expect(bind).toHaveLength(32);
	});

	it('aggregated Q signatures pass the SDK verifier on checkpoint and ark tx', async () => {
		const s = spend('settle');
		const sigs = s.sighashes.map(musigSign);
		const id = presignedIdentity({ qXonly: Q, sighashes: s.sighashes, signatures: sigs });
		const ark = await id.sign(s.offchain.arkTx);
		const cp = await id.sign(s.offchain.checkpoints[0]);
		verifyTapscriptSignatures(ark, 0, [hx(Q)], [hx(OP_X)], [SigHash.DEFAULT], s.leafHash);
		verifyTapscriptSignatures(cp, 0, [hx(Q)], [hx(OP_X)], [SigHash.DEFAULT], s.leafHash);
	});

	it('refuses a wrong signature and a mutated tx', async () => {
		const s = spend('settle');
		const sigs = s.sighashes.map(musigSign);
		expect(() => presignedIdentity({ qXonly: Q, sighashes: s.sighashes, signatures: [sigs[1], sigs[0]] })).toThrow(
			/does not verify/
		);
		const id = presignedIdentity({ qXonly: Q, sighashes: s.sighashes, signatures: sigs });
		const mutated = spend('refund').offchain.arkTx;
		await expect(id.sign(mutated)).rejects.toThrow(/no presigned signature/);
	});

	it('submits through signAndSubmitOffchainTx with the operator co-signing', async () => {
		const s = spend('settle');
		const sigs = s.sighashes.map(musigSign);
		const aggregateSigsHex = hx(sigs[0]) + hx(sigs[1]);
		let finalized: string[] = [];
		const provider = {
			async submitTx(signedArkTx: string, checkpointTxs: string[]) {
				const ark = Transaction.fromPSBT(base64.decode(signedArkTx));
				verifyTapscriptSignatures(ark, 0, [hx(Q)], [hx(OP_X)], [SigHash.DEFAULT], s.leafHash);
				ark.signIdx(OPERATOR, 0);
				const cps = checkpointTxs.map((c) => {
					const t = Transaction.fromPSBT(base64.decode(c));
					t.signIdx(OPERATOR, 0);
					return base64.encode(t.toPSBT());
				});
				return { arkTxid: ark.id, finalArkTx: base64.encode(ark.toPSBT()), signedCheckpointTxs: cps };
			},
			async finalizeTx(_id: string, cps: string[]) {
				finalized = cps;
			}
		};
		const txid = await submitArkSpend({ spend: s, qXonly: Q, aggregateSigsHex, provider });
		expect(txid).toBe(s.offchain.arkTx.id);
		expect(finalized).toHaveLength(1);
		const cp = Transaction.fromPSBT(base64.decode(finalized[0]));
		verifyTapscriptSignatures(cp, 0, [hx(Q), hx(OP_X)], [], [SigHash.DEFAULT], s.leafHash);
		expect(hx(tapscriptSighash(cp, 0))).toBe(hx(s.sighashes[0]));
	});
});
