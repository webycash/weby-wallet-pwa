import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'wasm-artifacts.json'), 'utf8'));
const failures = [];

// extro-node arrives as the @extro/node git dependency: every lockfile that
// ships it (the wallet, and the OG worker that reads token status with it)
// must resolve exactly the commit this manifest pins (its files are hashed below).
for (const lockPath of ['package-lock.json', 'worker/package-lock.json']) {
  const lock = JSON.parse(await readFile(resolve(root, lockPath), 'utf8'));
  const resolved = lock.packages?.['node_modules/@extro/node']?.resolved ?? '';
  const lockedCommit = resolved.split('#')[1];
  if (lockedCommit !== manifest.sources.extroNode.commit) {
    failures.push(
      `${lockPath} resolves @extro/node at ${lockedCommit ?? '(missing)'}, manifest pins ${manifest.sources.extroNode.commit}`
    );
  }
}

for (const [relativePath, expected] of Object.entries(manifest.files)) {
  let bytes;
  try {
    bytes = await readFile(resolve(root, relativePath));
  } catch {
    failures.push(`${relativePath}: missing`);
    continue;
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) failures.push(`${relativePath}: expected ${expected}, got ${actual}`);
}

if (failures.length > 0) {
  console.error(`[verify-wasm] release artifacts are invalid:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(
  `[verify-wasm] ${Object.keys(manifest.files).length} artifacts verified ` +
    `(extro-node ${manifest.sources.extroNode.commit.slice(0, 8)}, ` +
    `wallet ${manifest.sources.walletWasm.commit.slice(0, 8)})`
);
