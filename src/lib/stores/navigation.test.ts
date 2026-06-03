// Navigation store — the menu-as-data contract.
//
// These assert the pure two-level model: selecting a tab resets to its default
// view AND swaps the left menu; `currentMenu()` returns the active tab's items;
// Mining is present ONLY in Webcash's menu (roaming filtering happens in the
// view layer, but the item itself must exist nowhere else).
import { describe, it, expect, beforeEach } from 'vitest';
import {
	nav, selectTab, selectView, currentMenu,
	TAB_MENUS, TABS, ASSET_TABS, DEFAULT_VIEW, isAssetTab,
	openSettings, closeSettings, type Tab,
} from './navigation.svelte';

beforeEach(() => {
	// Reset to a known state — selectTab is the canonical reset.
	selectTab('webcash');
});

describe('selectTab', () => {
	it('resets activeView to the tab default and swaps the menu', () => {
		selectTab('rgb');
		expect(nav.activeTab).toBe('rgb');
		expect(nav.activeView).toBe(DEFAULT_VIEW.rgb);
		expect(currentMenu()).toBe(TAB_MENUS.rgb);

		selectTab('vouchers');
		expect(nav.activeView).toBe(DEFAULT_VIEW.vouchers);
		expect(currentMenu()).toBe(TAB_MENUS.vouchers);
	});

	it('clears the settings overlay and mobile menu', () => {
		openSettings();
		expect(nav.settingsOpen).toBe(true);
		selectTab('bitcoin');
		expect(nav.settingsOpen).toBe(false);
		expect(nav.mobileMenuOpen).toBe(false);
	});

	it('resets the view for every declared tab', () => {
		for (const t of TABS) {
			selectTab(t.id);
			expect(nav.activeView).toBe(DEFAULT_VIEW[t.id]);
		}
	});
});

describe('selectView', () => {
	it('sets the view within the active tab without changing the tab', () => {
		selectTab('bitcoin');
		selectView('receive');
		expect(nav.activeTab).toBe('bitcoin');
		expect(nav.activeView).toBe('receive');
	});
});

describe('currentMenu', () => {
	it('returns exactly the active tab menu', () => {
		for (const t of TABS) {
			selectTab(t.id);
			expect(currentMenu()).toEqual(TAB_MENUS[t.id]);
		}
	});
});

describe('Mining placement', () => {
	const hasMining = (tab: Tab) => TAB_MENUS[tab].some((i) => i.view === 'mining');

	it('appears only in the Webcash menu', () => {
		expect(hasMining('webcash')).toBe(true);
		for (const t of TABS) {
			if (t.id === 'webcash') continue;
			expect(hasMining(t.id)).toBe(false);
		}
	});
});

describe('settings overlay', () => {
	it('opens and closes without mutating the active view', () => {
		selectTab('webcash');
		selectView('stats');
		openSettings();
		expect(nav.settingsOpen).toBe(true);
		expect(nav.activeView).toBe('stats');
		closeSettings();
		expect(nav.settingsOpen).toBe(false);
		expect(nav.activeView).toBe('stats');
	});
});

describe('tab classification', () => {
	it('treats the four families as asset tabs and exchange as a mode', () => {
		for (const t of ASSET_TABS) expect(isAssetTab(t)).toBe(true);
		expect(isAssetTab('exchange')).toBe(false);
	});
});
