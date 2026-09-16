#!/usr/bin/env node
/**
 * GATE3_ARK_FUNDED_VTXO_COSIGN — arkade-regtest harness (Node).
 * Boarded CLI wallet privkey → conditional VTXO → MuSig2 settle cosign.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventSource } from 'eventsource';
import {
	Wallet,
	SingleKey,
	RestArkProvider,
	EsploraProvider,
	DefaultVtxo,
	CSVMultisigTapscript,
	VtxoScript,
	scriptFromTapLeafScript,
	getNetwork,
	configureEventSource,
	InMemoryVirtualTxRepository,
	InMemoryWalletRepository,
	InMemoryContractRepository,
	InMemoryIntentRepository
} from '@arkade-os/sdk';

configureEventSource((url) => new EventSource(url));

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const arg = (n, d) => {
	const i = process.argv.indexOf(n);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const hex = (b) => Buffer.from(b).toString('hex');
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
const fail = (m) => {
	console.error(`GATE3 FAIL: ${m}`);
	process.exit(1);
};

async function main() {
	const aspUrl = arg('--asp', 'http://127.0.0.1:7070');
	const esploraUrl = arg('--esplora', 'http://127.0.0.1:3000/api');
	const privkey = arg('--privkey');
	const amountSats = BigInt(arg('--amount', '25000'));
	const outPath = arg('--out', resolve(ROOT, 'test-results/gate3-funded-vtxo-cosign.json'));
	const cosignBin = arg('--cosign-bin', resolve(ROOT, '../_regtest/bin/gate3_musig2_cosign'));

	if (!privkey || !/^[0-9a-fA-F]{64}$/.test(privkey)) fail('--privkey 32-byte hex required');

	const info = await (await fetch(`${aspUrl}/v1/info`)).json();
	if (info.network !== 'regtest') fail(`expected regtest got ${info.network}`);
	const operatorXOnly = String(info.signerPubkey).toLowerCase().slice(2);
	const unilateralExitDelay = BigInt(info.unilateralExitDelay);

	const identity = SingleKey.fromHex(privkey);
	const wallet = await Wallet.create({
		identity,
		arkProvider: new RestArkProvider(aspUrl),
		onchainProvider: new EsploraProvider(esploraUrl),
		storage: {
			walletRepository: new InMemoryWalletRepository(),
			contractRepository: new InMemoryContractRepository(),
			intentRepository: new InMemoryIntentRepository(),
			virtualTxRepository: new InMemoryVirtualTxRepository()
		}
	});

	const offchainAddress = await wallet.getAddress();
	const balanceBefore = await wallet.getBalance();
	console.error('[gate3] address', offchainAddress);
	console.error('[gate3] balanceBefore', JSON.stringify(balanceBefore));

	const providerRecovery = SingleKey.fromRandomBytes();
	const aggregateOwner = SingleKey.fromRandomBytes();
	const providerRecoveryXOnly = await providerRecovery.xOnlyPublicKey();
	const aggregateOwnerXOnly = await aggregateOwner.xOnlyPublicKey();
	const operatorSignerKey = Buffer.from(operatorXOnly, 'hex');
	const requestCommitment = randomBytes(32);
	const timelock = {
		value: unilateralExitDelay,
		type: unilateralExitDelay < 512n ? 'blocks' : 'seconds'
	};
	const standard = new DefaultVtxo.Script({
		pubKey: aggregateOwnerXOnly,
		serverPubKey: operatorSignerKey,
		csvTimelock: timelock
	});
	const recovery = CSVMultisigTapscript.encode({
		pubkeys: [providerRecoveryXOnly],
		timelock
	});
	const commitmentLeaf = new Uint8Array(34);
	commitmentLeaf[0] = 0x6a;
	commitmentLeaf[1] = 0x20;
	commitmentLeaf.set(requestCommitment, 2);
	const script = new VtxoScript([
		scriptFromTapLeafScript(standard.forfeit()),
		recovery.script,
		commitmentLeaf
	]);
	const network = getNetwork('regtest');
	const conditionalAddress = script.address(network.hrp, operatorSignerKey).encode();
	const tapTree = script.encode();
	const pkScriptHex = hex(script.pkScript);
	console.error('[gate3] conditional', conditionalAddress);

	const spendable = await wallet.getSpendableVtxos();
	console.error('[gate3] spendableVtxos', spendable.length, spendable.map((v) => ({ t: v.txid?.slice(0, 8), v: v.value })));

	const arkTxId = await wallet.send({
		recipients: [{ address: conditionalAddress, amount: Number(amountSats), tapTree: tapTree.slice() }]
	});
	if (!/^[0-9a-f]{64}$/i.test(arkTxId)) fail(`bad funding txid ${arkTxId}`);
	console.error('[gate3] arkTxId', arkTxId);

	let lockedRef = `${arkTxId.toLowerCase()}:0`;
	for (let i = 0; i < 20; i++) {
		const vtxos = await wallet.getVtxos({ withRecoverable: true }).catch(() => []);
		const exact = vtxos.find(
			(v) => !v.isSpent && v.script?.toLowerCase?.() === pkScriptHex && BigInt(v.value) === amountSats
		);
		if (exact?.txid != null) {
			lockedRef = `${String(exact.txid).toLowerCase()}:${Number(exact.vout)}`;
			break;
		}
		await new Promise((r) => setTimeout(r, 400));
	}

	const balanceAfter = await wallet.getBalance();
	const settleCanonical = [
		`leaf=collaborative-settle`,
		`locked_ref=${lockedRef}`,
		`amount_sats=${amountSats}`,
		`destination=${conditionalAddress}`,
		`network=regtest`,
		`swap_id=gate3-funded-vtxo`,
		`request_commitment=${hex(requestCommitment)}`,
		`aggregate_owner=${hex(aggregateOwnerXOnly)}`,
		`provider_recovery=${hex(providerRecoveryXOnly)}`,
		`operator_signer=${operatorXOnly}`,
		`unilateral_exit_delay=${unilateralExitDelay}`
	].join('\n');
	const refundCanonical = settleCanonical.replace(
		'leaf=collaborative-settle',
		'leaf=provider-csv-refund'
	);
	const settleDigest = sha256Hex(settleCanonical);
	const refundDigest = sha256Hex(refundCanonical);
	if (settleDigest === refundDigest) fail('XOR digests collided');

	const cosign = spawnSync(
		cosignBin,
		['--msg', settleDigest, '--fill-id', `gate3:${lockedRef}`, '--session', 'settle'],
		{ encoding: 'utf8', timeout: 15_000 }
	);
	if (cosign.status !== 0) fail(`cosign failed: ${cosign.stderr || cosign.stdout}`);
	const receipt = JSON.parse(cosign.stdout.trim().split('\n').filter(Boolean).pop());
	if (!receipt.signatureHex || receipt.signatureHex.length < 64) fail('empty cosign');
	if (/^(ab|cf){32}$/i.test(receipt.signatureHex) || /^0+$/i.test(receipt.signatureHex)) {
		fail('placeholder cosign');
	}

	const offBefore = Number(balanceBefore?.offchain?.total ?? balanceBefore?.available ?? 0);
	const offAfter = Number(balanceAfter?.offchain?.total ?? balanceAfter?.available ?? 0);

	const evidence = {
		gate: 'GATE3_ARK_FUNDED_VTXO_COSIGN',
		result: 'PASS',
		timestamp: new Date().toISOString(),
		asp: {
			url: aspUrl,
			network: info.network,
			version: info.version,
			signer_pk_hex: operatorXOnly,
			info_digest_hex: String(info.digest).toLowerCase(),
			checkpoint_tapscript_hex: String(info.checkpointTapscript).toLowerCase(),
			unilateral_exit_delay: Number(unilateralExitDelay)
		},
		funding: {
			ark_txid: arkTxId.toLowerCase(),
			locked_ref: lockedRef,
			amount_sats: Number(amountSats),
			conditional_address: conditionalAddress,
			pk_script_hex: pkScriptHex,
			request_commitment_hex: hex(requestCommitment)
		},
		balances: {
			before: balanceBefore,
			after: balanceAfter,
			offchain_delta_sats: offAfter - offBefore
		},
		cosign: {
			path: 'collaborative-settle',
			settle_digest_hex: settleDigest,
			refund_digest_hex: refundDigest,
			signature_hex: receipt.signatureHex,
			provider_pubkey_hex: receipt.providerPubkeyHex,
			referee_pubkey_hex: receipt.refereePubkeyHex,
			asp_ref: receipt.aspRef
		}
	};
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence, null, 2));
	console.error(`[gate3] PASS ${outPath}`);
}

main().catch((e) => {
	console.error(e);
	fail(e.message || String(e));
});
