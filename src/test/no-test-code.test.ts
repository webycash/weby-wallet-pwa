import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findTestCodeViolations } from '../../scripts/check-no-test-code.mjs';

describe('audit M8: no mocks/fixtures in production source', () => {
	it('the repo is clean', async () => {
		expect(await findTestCodeViolations(resolve(__dirname, '../..'))).toEqual([]);
	});

	it('flags a production import of src/test and a mock module in src/lib', async () => {
		const root = await mkdtemp(join(tmpdir(), 'm8-'));
		await mkdir(join(root, 'src/lib/x'), { recursive: true });
		await mkdir(join(root, 'src/test/fixtures'), { recursive: true });
		await writeFile(join(root, 'src/test/fixtures/thing.ts'), 'export const t = 1;\n');
		await writeFile(join(root, 'src/lib/x/mock-data.ts'), 'export const m = 1;\n');
		await writeFile(join(root, 'src/lib/x/app.ts'), "import { t } from '../../test/fixtures/thing';\nimport { m } from '$lib/x/mock-data';\n");
		await writeFile(join(root, 'src/lib/x/app.test.ts'), "import { t } from '../../test/fixtures/thing';\n");
		const v: string[] = await findTestCodeViolations(root);
		expect(v.some((s) => s.includes('src/lib/x/mock-data.ts: mock/fixture module'))).toBe(true);
		expect(v.some((s) => s.includes("app.ts: imports test-only module '../../test/fixtures/thing'"))).toBe(true);
		expect(v.some((s) => s.includes("app.ts: imports test-only module '$lib/x/mock-data'"))).toBe(true);
		expect(v.some((s) => s.includes('app.test.ts'))).toBe(false);
	});
});
