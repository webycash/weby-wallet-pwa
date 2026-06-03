/**
 * Two-level navigation.
 *
 * Top level: a {@link Tab} — the four asset families plus the Exchange mode.
 * Selecting a tab fully swaps the left menu, which is pure data ({@link TAB_MENUS}).
 * Within a tab, {@link nav.activeView} selects one menu entry.
 *
 * Every transition here is pure and immutable: it only sets fields on the `nav`
 * rune. Side effects (switching the wallet family for an asset tab, draining
 * hooks, etc.) live in the shell that *observes* `nav` — never in this store.
 * The menu is data, not branching: one config drives header, sidebar and mobile.
 *
 * Mining is intentionally present ONLY in the Webcash menu. Settings is a global
 * overlay reachable from any tab, never a per-tab view.
 */
import type { Component } from 'svelte';
import {
	Wallet, Pickaxe, Merge, RotateCcw, ShieldCheck, BarChart3,
	ArrowDownToLine, ArrowUpFromLine, Anchor, History,
	Gem, ArrowLeftRight, PlusCircle, FileText,
	Ticket, Gift,
	LayoutGrid, CandlestickChart, ScrollText, Radio,
} from '@lucide/svelte';

export type Tab = 'webcash' | 'bitcoin' | 'rgb' | 'vouchers' | 'exchange';

/** The wallet-bearing tabs (one asset family each). `exchange` is a mode, not a family. */
export const ASSET_TABS = ['webcash', 'bitcoin', 'rgb', 'vouchers'] as const;
export type AssetTab = (typeof ASSET_TABS)[number];
export const isAssetTab = (t: Tab): t is AssetTab =>
	(ASSET_TABS as readonly string[]).includes(t);

/** Ordered top-level tabs for the header bar. */
export const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
	{ id: 'webcash', label: 'Webcash' },
	{ id: 'bitcoin', label: 'Bitcoin' },
	{ id: 'rgb', label: 'RGB' },
	{ id: 'vouchers', label: 'Vouchers' },
	{ id: 'exchange', label: 'Exchange' },
];

/** One left-menu entry. `view` is unique within its tab. */
export interface NavItem {
	readonly view: string;
	readonly label: string;
	readonly icon: Component;
}

/**
 * The left menu per tab — pure data. Selecting a tab renders exactly this list,
 * so the menu "totally changes" per tab by construction. Mining lives only under
 * Webcash; per-asset value movement (Send/Receive/Issue/Transfer/Redeem/ARK) is
 * uniform across the asset tabs.
 */
export const TAB_MENUS: Record<Tab, readonly NavItem[]> = {
	webcash: [
		{ view: 'balance', label: 'Balance', icon: Wallet },
		{ view: 'mining', label: 'Mining', icon: Pickaxe },
		{ view: 'merge', label: 'Merge', icon: Merge },
		{ view: 'recover', label: 'Recover', icon: RotateCcw },
		{ view: 'verify', label: 'Verify', icon: ShieldCheck },
		{ view: 'stats', label: 'Stats', icon: BarChart3 },
	],
	bitcoin: [
		{ view: 'balance', label: 'Balance', icon: Wallet },
		{ view: 'receive', label: 'Receive', icon: ArrowDownToLine },
		{ view: 'send', label: 'Send', icon: ArrowUpFromLine },
		{ view: 'ark', label: 'ARK', icon: Anchor },
		{ view: 'history', label: 'History', icon: History },
	],
	rgb: [
		{ view: 'assets', label: 'Assets', icon: Gem },
		{ view: 'receive', label: 'Receive', icon: ArrowDownToLine },
		{ view: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
		{ view: 'issue', label: 'Issue', icon: PlusCircle },
		{ view: 'contracts', label: 'Contracts', icon: FileText },
	],
	vouchers: [
		{ view: 'vouchers', label: 'Vouchers', icon: Ticket },
		{ view: 'receive', label: 'Receive', icon: ArrowDownToLine },
		{ view: 'redeem', label: 'Redeem', icon: Gift },
		{ view: 'issue', label: 'Issue', icon: PlusCircle },
		{ view: 'history', label: 'History', icon: History },
	],
	exchange: [
		{ view: 'markets', label: 'Markets', icon: LayoutGrid },
		{ view: 'trade', label: 'Trade', icon: CandlestickChart },
		{ view: 'orders', label: 'Orders', icon: ScrollText },
		{ view: 'network', label: 'Network', icon: Radio },
	],
};

/** The view shown when a tab is first opened. */
export const DEFAULT_VIEW: Record<Tab, string> = {
	webcash: 'balance',
	bitcoin: 'balance',
	rgb: 'assets',
	vouchers: 'vouchers',
	exchange: 'markets',
};

/** Settings is a global overlay with per-area sub-tabs, reachable from any tab. */
export type SettingsTab = 'wallet' | 'master' | 'webcash' | 'bitcoin' | 'rgb' | 'vouchers';

const nav = $state({
	activeTab: 'webcash' as Tab,
	activeView: DEFAULT_VIEW.webcash as string,
	settingsOpen: false,
	activeSettingsTab: 'wallet' as SettingsTab,
	mobileMenuOpen: false,
});

export { nav };

/** Select a top-level tab; resets to that tab's default view. Pure. */
export const selectTab = (tab: Tab): void => {
	nav.activeTab = tab;
	nav.activeView = DEFAULT_VIEW[tab];
	nav.settingsOpen = false;
	nav.mobileMenuOpen = false;
};

/** Select a view within the active tab. Pure. */
export const selectView = (view: string): void => {
	nav.activeView = view;
	nav.settingsOpen = false;
	nav.mobileMenuOpen = false;
};

/** The left menu for the active tab. */
export const currentMenu = (): readonly NavItem[] => TAB_MENUS[nav.activeTab];

/** Open the global settings overlay (optionally at a given sub-tab). Pure. */
export const openSettings = (tab: SettingsTab = nav.activeSettingsTab): void => {
	nav.activeSettingsTab = tab;
	nav.settingsOpen = true;
	nav.mobileMenuOpen = false;
};
export const closeSettings = (): void => { nav.settingsOpen = false; };
export const setSettingsTab = (tab: SettingsTab): void => { nav.activeSettingsTab = tab; };

export const openMenu = (): void => { nav.mobileMenuOpen = true; };
export const closeMenu = (): void => { nav.mobileMenuOpen = false; };
