import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Installs the proving keys of one ZKP profile into static/<dir>/ after
// checking every file against zkp-artifacts.json.
//
//   ZKP_PROFILE=<profile> ZKP_ARTIFACT_DIR=<extro-circuits key dir> npm run install:zkp
//
// development-only: extro-circuits circuits-dev/ (dev_ceremony output).
// mpc-*: extro-circuits circuits-mpc/ (ceremony/ import, see ceremony/README.md).

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'zkp-artifacts.json'), 'utf8'));
const profileName = process.env.ZKP_PROFILE;
const sourceDir = process.env.ZKP_ARTIFACT_DIR;

if (!profileName || !sourceDir) {
	console.error(
		'[install-zkp] ZKP_PROFILE and ZKP_ARTIFACT_DIR are required. Profiles: ' +
			Object.keys(manifest.profiles).join(', ')
	);
	process.exit(1);
}
const profile = Object.hasOwn(manifest.profiles, profileName) ? manifest.profiles[profileName] : null;
if (!profile) {
	console.error(`[install-zkp] unknown ZKP profile \`${profileName}\``);
	process.exit(1);
}

const destination = resolve(root, 'static', profile.dir);
await mkdir(destination, { recursive: true });

for (const [file, expected] of Object.entries(profile.files)) {
	const bytes = await readFile(resolve(sourceDir, file));
	const actual = createHash('sha256').update(bytes).digest('hex');
	if (actual !== expected) {
		console.error(`[install-zkp] ${file}: expected ${expected}, got ${actual}`);
		process.exit(1);
	}
	await writeFile(resolve(destination, file), bytes);
}

console.log(
	`[install-zkp] installed ${Object.keys(profile.files).length} ${profileName} artifacts ` +
		`into static/${profile.dir} from extro-circuits ${profile.source.commit.slice(0, 8)}`
);
