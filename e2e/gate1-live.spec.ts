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

test('Gates 1-2 live: two isolated wallets retain a DataChannel and propagate a signed DHTX order', async ({
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

		const pair = { base: 'BitcoinArk', quote: 'Webcash' };
		const published = (await command(nodes[0], {
			kind: 'Dhtx',
			cmd: {
				op: 'PublishOrder',
				slot: 0,
				pair,
				side: 'Sell',
				price_atomic: 12_345n,
				amount_atomic: 67n,
				expires_at: Math.floor(Date.now() / 1000) + 300
			}
		})) as any;
		expect(published.kind, JSON.stringify(published)).toBe('Ok');
		expect(published.body.kind).toBe('OrderPublished');
		expect(published.body.peers_broadcast, JSON.stringify(published.body)).toBeGreaterThan(0);
		const publishedId = Array.from(published.body.order_id as Uint8Array).join(',');

		let received: any = null;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			const fetched = (await command(nodes[1], {
				kind: 'Dhtx',
				cmd: { op: 'FetchOrders', pair }
			})) as any;
			expect(fetched.kind).toBe('Ok');
			expect(fetched.body.kind).toBe('Orders');
			received = fetched.body.orders.find(
				(order: any) => Array.from(order.order_id as Uint8Array).join(',') === publishedId
			);
			if (received) {
				expect(fetched.body.diag.peers_connected).toBeGreaterThan(0);
				expect(fetched.body.diag.channels_open).toBeGreaterThan(0);
				expect(fetched.body.diag.total_frames_seen).toBeGreaterThan(0);
				expect(fetched.body.diag.orders_recorded).toBeGreaterThan(0);
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		expect(received, 'peer B never recorded peer A\'s signed DHTX order').not.toBeNull();
		expect(received.pair).toEqual(pair);
		expect(received.side).toBe('Sell');
		expect(received.price_atomic).toBe(12_345n);
		expect(received.amount_atomic).toBe(67n);
		expect((received.signed_commitment as Uint8Array).length).toBeGreaterThan(64);
	} finally {
		await Promise.all(nodes.map((node) => node.context.close()));
	}
});
