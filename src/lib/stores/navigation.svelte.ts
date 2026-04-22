export type View = 'dashboard' | 'mining' | 'merge' | 'recovery' | 'verify' | 'settings' | 'stats';
export type MobileScreen = 'menu' | 'settings' | 'settings-detail';
export type SettingsTab = 'wallet' | 'master' | 'webcash' | 'bitcoin' | 'rgb' | 'vouchers';

const nav = $state({
	activeView: 'dashboard' as View,
	mobileMenuOpen: false,
	mobileScreen: 'menu' as MobileScreen,
	activeSettingsTab: 'wallet' as SettingsTab,
});

export { nav };

export const navigateTo = (view: View) => {
	nav.activeView = view;
	nav.mobileMenuOpen = false;
	nav.mobileScreen = 'menu';
};

export const openMenu = () => { nav.mobileMenuOpen = true; nav.mobileScreen = 'menu'; };
export const closeMenu = () => { nav.mobileMenuOpen = false; nav.mobileScreen = 'menu'; };

export const pushSettings = () => { nav.mobileScreen = 'settings'; };
export const popSettings = () => { nav.mobileScreen = 'menu'; };

export const pushSettingsDetail = (tab: SettingsTab) => { nav.activeSettingsTab = tab; nav.mobileScreen = 'settings-detail'; };
export const popSettingsDetail = () => { nav.mobileScreen = 'settings'; };

export const setSettingsTab = (tab: SettingsTab) => { nav.activeSettingsTab = tab; };
