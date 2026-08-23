import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'wasm-artifacts.json'), 'utf8'));
const failures = [];

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
