// Where a page load on a wallet origin goes (ADR-0008 §12). Pure, so it is
// unit-tested; +layout.ts feeds it the runtime config and this origin's state.
//
// The wallet home (config `wallet_home_origin`) serves everything. A legacy
// origin (any other origin running this build, e.g. weby.cash/wallet) never
// holds a new wallet: with no wallet here, or one already moved, it forwards
// the same path + query + hash to the home (so shared links like
// `?webcash=…` gifts keep working; the static HTML keeps its OG cards for
// crawlers). A wallet still stored here is never forwarded silently: the user
// is sent to `${base}/move` to confirm the device-local move (or defer it).

export type HomeRoute =
	| { kind: 'home' } // this origin is the wallet home
	| { kind: 'migrate' } // the home's import popup: do not boot the node
	| { kind: 'move-page' } // legacy origin, the move page itself: do not boot the node
	| { kind: 'stay' } // legacy origin, wallet kept here for this session (deferred)
	| { kind: 'move'; url: string; next: string } // legacy origin, wallet still here
	| { kind: 'forward'; url: string }; // legacy origin → the home

export interface HomeRouteInput {
	origin: string;
	home: string;
	base: string;
	pathname: string;
	search: string;
	hash: string;
	hasWallet: boolean;
	moved: boolean;
	deferred: boolean;
}

const under = (pathname: string, base: string, page: string) => {
	const p = pathname.replace(/\/+$/, '').replace(/\.html$/, '');
	return p === `${base}/${page}`;
};

export function homeRoute(i: HomeRouteInput): HomeRoute {
	if (i.origin === i.home) return under(i.pathname, i.base, 'migrate') ? { kind: 'migrate' } : { kind: 'home' };
	if (under(i.pathname, i.base, 'move')) return { kind: 'move-page' };
	if (!i.hasWallet || i.moved) return { kind: 'forward', url: `${i.home}${i.pathname}${i.search}${i.hash}` };
	if (i.deferred) return { kind: 'stay' };
	return { kind: 'move', url: `${i.base}/move`, next: `${i.pathname}${i.search}${i.hash}` };
}

/** sessionStorage: "use the wallet here for this session" and the page to return to. */
export const MOVE_DEFER_KEY = 'weby_move_deferred';
export const MOVE_NEXT_KEY = 'weby_move_next';
