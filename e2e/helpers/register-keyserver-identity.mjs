#!/usr/bin/env node
/**
 * Register TEST_MNEMONICS A/B identities on local extro-keyserver so referee
 * prepare can resolve party fingerprints (fails closed on 404 otherwise).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { ed25519 } from '@noble/curves/ed25519.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PURPOSE = 83696968;
const FAMILY_PGP = 4;
const KS = process.env.KEYSERVER_URL ?? 'http://127.0.0.1:7800';
const SEED_BIN =
	process.env.SEED_DEV_F1_BIN ??
	resolve(__dirname, '../../../../extro/extro-keyserver/target/release/examples/seed_dev_f1_identity');

const MNEMONICS = {
	A: 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
	B: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'
};

function identity(mnemonic) {
	const sk = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, '')).derive(
		`m/${PURPOSE}'/0'/${FAMILY_PGP}'/0'`
	).privateKey;
	if (!sk) throw new Error('missing sk');
	const vk = ed25519.getPublicKey(sk);
	const fp = createHash('sha256').update(vk).digest('hex').slice(0, 40);
	return { sk: Buffer.from(sk).toString('hex'), fp, vk: Buffer.from(vk).toString('hex') };
}

function httpCode(args) {
	return execFileSync('curl', args, { encoding: 'utf8' }).trim();
}

function register(nick, sk, fp) {
	const look = httpCode(['-sS', '-o', '/dev/null', '-w', '%{http_code}', `${KS}/api/v1/identity/record/${fp}`]);
	if (look === '200') {
		console.error(`[ks-reg] ${nick} already present ${fp}`);
		return fp;
	}
	const outDir = resolve(__dirname, '../../test-results/ks-reg');
	mkdirSync(outDir, { recursive: true });
	const challenge = resolve(outDir, `challenge-${nick}.bin`);
	const retry = resolve(outDir, `retry-${nick}.bin`);
	const chCode = httpCode([
		'-sS', '-o', challenge, '-w', '%{http_code}', '-X', 'POST',
		`${KS}/api/v1/identity/register`, '--data-binary', ''
	]);
	if (chCode !== '402') throw new Error(`challenge ${nick} HTTP ${chCode}`);
	execFileSync(SEED_BIN, [nick, sk, challenge, retry], { stdio: 'inherit' });
	const regCode = httpCode([
		'-sS', '-o', resolve(outDir, `reg-${nick}.bin`), '-w', '%{http_code}',
		'-X', 'POST', '-H', 'content-type: application/octet-stream',
		'--data-binary', `@${retry}`, `${KS}/api/v1/identity/register`
	]);
	if (regCode !== '200' && regCode !== '201') throw new Error(`register ${nick} HTTP ${regCode}`);
	const again = httpCode(['-sS', '-o', '/dev/null', '-w', '%{http_code}', `${KS}/api/v1/identity/record/${fp}`]);
	if (again !== '200') throw new Error(`lookup ${nick} after register HTTP ${again}`);
	console.error(`[ks-reg] ${nick} registered ${fp}`);
	return fp;
}

const results = {};
for (const [nick, mnemonic] of Object.entries(MNEMONICS)) {
	const id = identity(mnemonic);
	results[nick] = { fp: register(nick === 'A' ? 'maker-a' : 'taker-b', id.sk, id.fp), ...id };
}
mkdirSync(resolve(__dirname, '../../test-results/ks-reg'), { recursive: true });
writeFileSync(resolve(__dirname, '../../test-results/ks-reg/ids.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ A: results.A.fp, B: results.B.fp }));
