import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'zkp-artifacts.json'), 'utf8'));
const sourceDir = process.env.ZKP_ARTIFACT_DIR;

if (!sourceDir) {
	console.error(
		'[install-zkp] ZKP_ARTIFACT_DIR is required. Generate the pinned development ' +
			'ceremony in extro-circuits, then point this command at its circuits-dev directory.'
	);
	process.exit(1);
}

const destination = resolve(root, 'static/circuits-dev');
await mkdir(destination, { recursive: true });

for (const [file, expected] of Object.entries(manifest.files)) {
	const bytes = await readFile(resolve(sourceDir, file));
	const actual = createHash('sha256').update(bytes).digest('hex');
	if (actual !== expected) {
		console.error(`[install-zkp] ${file}: expected ${expected}, got ${actual}`);
		process.exit(1);
	}
	await writeFile(resolve(destination, file), bytes);
}

console.log(
	`[install-zkp] installed ${Object.keys(manifest.files).length} ${manifest.profile} artifacts ` +
		`from extro-circuits ${manifest.source.commit.slice(0, 8)}`
);
