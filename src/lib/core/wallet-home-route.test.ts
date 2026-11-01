import { describe, expect, it } from 'vitest';
import { homeRoute, type HomeRouteInput } from './wallet-home-route';

const at = (o: Partial<HomeRouteInput>): HomeRouteInput => ({
	origin: 'https://dev.weby.cash',
	home: 'https://dev.extro.network',
	base: '/wallet',
	pathname: '/wallet/',
	search: '',
	hash: '',
	hasWallet: false,
	moved: false,
	deferred: false,
	...o
});

describe('homeRoute', () => {
	it('the home serves everything; its /migrate popup skips the node boot', () => {
		const home = { origin: 'https://dev.extro.network', hasWallet: true };
		expect(homeRoute(at({ ...home }))).toEqual({ kind: 'home' });
		expect(homeRoute(at({ ...home, pathname: '/wallet/connect' }))).toEqual({ kind: 'home' });
		for (const p of ['/wallet/migrate', '/wallet/migrate/', '/wallet/migrate.html']) {
			expect(homeRoute(at({ ...home, pathname: p }))).toEqual({ kind: 'migrate' });
		}
	});

	it('a legacy origin without a wallet forwards path, query and hash to the home', () => {
		expect(homeRoute(at({ search: '?webcash=e1%3Asecret%3Aabc', hash: '#x' }))).toEqual({
			kind: 'forward',
			url: 'https://dev.extro.network/wallet/?webcash=e1%3Asecret%3Aabc#x'
		});
		expect(homeRoute(at({ pathname: '/wallet/connect', search: '?v=1' }))).toEqual({
			kind: 'forward',
			url: 'https://dev.extro.network/wallet/connect?v=1'
		});
	});

	it('a moved wallet forwards; a wallet still here goes to the move page, never silently forwarded', () => {
		expect(homeRoute(at({ hasWallet: true, moved: true })).kind).toBe('forward');
		expect(homeRoute(at({ hasWallet: true, search: '?webcash=x' }))).toEqual({
			kind: 'move',
			url: '/wallet/move',
			next: '/wallet/?webcash=x'
		});
		expect(homeRoute(at({ hasWallet: true, deferred: true }))).toEqual({ kind: 'stay' });
	});

	it('the move page itself always stays (no loop), whatever the state', () => {
		for (const hasWallet of [true, false]) {
			for (const moved of [true, false]) {
				expect(homeRoute(at({ pathname: '/wallet/move', hasWallet, moved }))).toEqual({ kind: 'move-page' });
			}
		}
	});

	it('a page that only shares a prefix is not the move or migrate page', () => {
		expect(homeRoute(at({ hasWallet: true, pathname: '/wallet/mover' })).kind).toBe('move');
		expect(homeRoute(at({ origin: 'https://dev.extro.network', pathname: '/wallet/migrated' })).kind).toBe('home');
	});
});
