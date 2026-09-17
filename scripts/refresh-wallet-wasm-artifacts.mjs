import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'wasm-artifacts.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const prefix = 'crates/wallet-wasm/pkg/';
let updated = 0;
for (const rel of Object.keys(manifest.files)) {
  if (!rel.startsWith(prefix)) continue;
  const bytes = await readFile(resolve(root, rel));
  manifest.files[rel] = createHash('sha256').update(bytes).digest('hex');
  updated += 1;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[refresh-wallet-wasm-artifacts] updated ${updated} wallet-wasm hashes`);
