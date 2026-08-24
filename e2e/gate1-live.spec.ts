import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const URL = process.env.E2E_BASE_URL ?? 'http://localhost:5183';
const MNEMONICS = [
	'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
	'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'
];

interface LiveNode {
	context: BrowserContext;
	page: Page;
}

async function openNode(browser: Browser): Promise<LiveNode> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(URL);
	await page.waitForFunction(() => Boolean((window as unknown as { __extro?: unknown }).__extro), {
		timeout: 60_000
	});
	return { context, page };
}

async function command(node: LiveNode, cmd: unknown) {
	return node.page.evaluate(async (value) => {
		const client = (window as unknown as { __extro: { send: (command: unknown) => Promise<unknown> } })
			.__extro;
		return client.send({ request_id: crypto.getRandomValues(new Uint8Array(16)), op: value });
	}, cmd);
}

test('Gate 1 live: two isolated wallets pin, discover, and retain a real DataChannel', async ({
	browser
}) => {
	const config = await (await fetch(`${URL.replace(/\/$/, '')}/runtime-config.json`)).json();
	const nodes = await Promise.all([openNode(browser), openNode(browser)]);
	try {
		for (let index = 0; index < nodes.length; index += 1) {
			const imported = (await command(nodes[index], {
				kind: 'Wallet',
				cmd: {
					op: 'Import',
					mnemonic: MNEMONICS[index],
					passphrase: new TextEncoder().encode('gate1-live-throwaway')
				}
			})) as any;
			expect(imported.kind, JSON.stringify(imported)).toBe('Ok');

			const identity = (await command(nodes[index], {
				kind: 'Wallet',
				cmd: { op: 'DeriveIdentity', slot: 0 }
			})) as any;
			expect(identity.kind, JSON.stringify(identity)).toBe('Ok');
			expect(identity.body.kind).toBe('Identity');

			const pinned = (await command(nodes[index], {
				kind: 'Keyserver',
				cmd: {
					op: 'Pin',
					base_url: config.keyserver_url,
					domain: config.keyserver_domain,
					fingerprint_hex: config.keyserver_fingerprint_hex,
					vk_hex: config.keyserver_vk_hex
				}
			})) as any;
			expect(pinned.kind, JSON.stringify(pinned)).toBe('Ok');

			const discovered = (await command(nodes[index], {
				kind: 'Keyserver',
				cmd: {
					op: 'Discover',
					base_url: config.keyserver_url,
					domain: config.keyserver_domain
				}
			})) as any;
			expect(discovered.kind, JSON.stringify(discovered)).toBe('Ok');
			expect(discovered.body.verified).toBe(true);
			expect(discovered.body.fingerprint_hex.toLowerCase()).toBe(
				config.keyserver_fingerprint_hex.toLowerCase()
			);
		}

		const bootstrap = (node: LiveNode) =>
			command(node, {
				kind: 'Keyserver',
				cmd: {
					op: 'Bootstrap',
					base_url: config.keyserver_url,
					domain: config.keyserver_domain
				}
			}) as Promise<any>;

		// A publishes its rendezvous offer first and waits on the answer mailbox.
		// B then receives A in its roster and opens the peer channel.
		const aPending = bootstrap(nodes[0]);
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const [a, b] = await Promise.all([aPending, bootstrap(nodes[1])]);
		for (const result of [a, b]) {
			expect(result.kind, JSON.stringify(result)).toBe('Ok');
			expect(result.body.kind).toBe('Bootstrapped');
		}
		expect(
			a.body.connected || b.body.connected || a.body.peers_connected > 0 || b.body.peers_connected > 0,
			`no open DataChannel: A=${JSON.stringify(a.body)} B=${JSON.stringify(b.body)}`
		).toBe(true);
	} finally {
		await Promise.all(nodes.map((node) => node.context.close()));
	}
});
