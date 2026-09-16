#!/usr/bin/env node
/**
 * GATE5: fund a MuSig2 2-of-2 Q-owned VTXO on arkade-regtest (JS SDK).
 * Owner key is the x-only Q from --owner-q (agg(referee, provider)), not a random key.
 */
import { createHash, randomBytes } from 'node:crypto';
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
const fail = (m) => {
	console.error(`GATE5 FUND FAIL: ${m}`);
	process.exit(1);
};

async function main() {
	const aspUrl = arg('--asp', 'http://127.0.0.1:7070');
	const esploraUrl = arg('--esplora', 'http://127.0.0.1:3000/api');
	const privkey = arg('--privkey');
	const ownerQ = arg('--owner-q');
	const amountSats = BigInt(arg('--amount', '25000'));
	const outPath = arg('--out', resolve(ROOT, 'test-results/gate5-fund-two-of-two.json'));
	if (!privkey || !/^[0-9a-fA-F]{64}$/.test(privkey)) fail('--privkey 32-byte hex required');
	if (!ownerQ || !/^[0-9a-fA-F]{64}$/.test(ownerQ)) fail('--owner-q 32-byte x-only hex required');

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

	const balanceBefore = await wallet.getBalance();
	console.error('[gate5-fund] balanceBefore', JSON.stringify(balanceBefore));

	const providerRecovery = SingleKey.fromRandomBytes();
	const providerRecoveryXOnly = await providerRecovery.xOnlyPublicKey();
	const aggregateOwnerXOnly = Buffer.from(ownerQ.toLowerCase(), 'hex');
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
	console.error('[gate5-fund] conditional', conditionalAddress);

	const arkTxId = await wallet.send({
		recipients: [{ address: conditionalAddress, amount: Number(amountSats), tapTree: tapTree.slice() }]
	});
	if (!/^[0-9a-f]{64}$/i.test(arkTxId)) fail(`bad funding txid ${arkTxId}`);
	console.error('[gate5-fund] arkTxId', arkTxId);

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
	const evidence = {
		gate: 'GATE5_FUND_TWO_OF_TWO',
		result: 'PASS',
		timestamp: new Date().toISOString(),
		asp: {
			url: aspUrl,
			network: info.network,
			version: info.version,
			signer_pk_hex: operatorXOnly,
			info_digest_hex: String(info.digest).toLowerCase(),
			unilateral_exit_delay: Number(unilateralExitDelay)
		},
		funding: {
			ark_txid: arkTxId.toLowerCase(),
			locked_ref: lockedRef,
			amount_sats: Number(amountSats),
			conditional_address: conditionalAddress,
			pk_script_hex: pkScriptHex,
			owner_q_hex: ownerQ.toLowerCase(),
			request_commitment_hex: hex(requestCommitment),
			provider_recovery_hex: hex(providerRecoveryXOnly)
		},
		balances: { before: balanceBefore, after: balanceAfter }
	};
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence, null, 2));
	console.error(`[gate5-fund] PASS ${outPath}`);
}

main().catch((e) => {
	console.error(e);
	fail(e.message || String(e));
});
