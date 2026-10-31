import { describe, it, expect } from 'vitest';
import { miningRefusal } from './miner-guard';

describe('miningRefusal', () => {
	it('allows dev deployment on dev webcash', () => {
		expect(miningRefusal({ deployment: 'development', webcash_server_url: 'https://dev.weby.cash/api/webcash' })).toBeNull();
	});
	it('refuses staging and production', () => {
		expect(miningRefusal({ deployment: 'staging', webcash_server_url: 'https://dev.weby.cash/api/webcash' })).toMatch(/staging/);
		expect(miningRefusal({ deployment: 'production', webcash_server_url: 'https://dev.weby.cash/api/webcash' })).toMatch(/production/);
	});
	it('refuses webcash.org even on development', () => {
		expect(miningRefusal({ deployment: 'development', webcash_server_url: 'https://webcash.org' })).toMatch(/mainnet/);
		expect(miningRefusal({ deployment: 'development', webcash_server_url: 'https://api.webcash.org/x' })).toMatch(/mainnet/);
	});
	it('fails closed without config', () => {
		expect(miningRefusal(null)).not.toBeNull();
		expect(miningRefusal({ deployment: 'development', webcash_server_url: 'nope' })).not.toBeNull();
	});
});
