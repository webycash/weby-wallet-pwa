// Per-connection spend budgets (doc 13 §3.4 `amount_caps`; ADR-0008 §9.6).
//
// The user may let one connected site or agent pay up to an amount of
// webcash per window without asking each time. Anything outside the budget
// is confirmed as before. Covered: wallet-funded `Rail PayWebcash` (no app
// inputs) on this wallet's own webcash server — the only spend whose amount
// the wallet both knows and pays. Budgets live in this wallet origin on this
// device and are dropped when the connection is disconnected.
import type { BudgetReservation, ConnectedApp, Connection, Op, SpendBudget } from '@extro/node';
import { WATS_PER_WEBCASH, webcashToWats } from '$lib/modules/webycash-exchange/bearer-reserve';
import { sameServer } from './wallet-fund';

export const DAY_SECS = 86_400;
const KEY_PREFIX = 'extro.spend-budget/v1|';
const ID_PATTERN = /^[0-9a-f]{32}$/;

export interface BudgetStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	readonly length?: number;
	key?(index: number): string | null;
}

type Entry = { id: string; at: number; wats: string; state: 'held' | 'spent' };
type Stored = { v: 1; rail: 'webcash'; amount_wats: string; window_secs: number; set_at: number; entries: Entry[] };

export interface BudgetView {
	/** Cap per window, in webcash (decimal string). */
	amount: string;
	window_secs: number;
	/** Spent or held in the current window, in webcash. */
	used: string;
	remaining: string;
}

const key = (connectionId: string) => {
	if (!ID_PATTERN.test(connectionId)) throw new Error('connection id must be 32 hex characters');
	return KEY_PREFIX + connectionId;
};

/** wats → decimal webcash string (no trailing zeros). */
export function watsToWebcash(wats: bigint): string {
	const whole = wats / WATS_PER_WEBCASH;
	const frac = (wats % WATS_PER_WEBCASH).toString().padStart(8, '0').replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : `${whole}`;
}

function read(storage: BudgetStorage, connectionId: string): Stored | null {
	const raw = storage.getItem(key(connectionId));
	if (raw === null) return null;
	try {
		const v = JSON.parse(raw) as Stored;
		if (v.v !== 1 || v.rail !== 'webcash' || !/^[0-9]+$/.test(v.amount_wats) || !(v.window_secs > 0) || !Array.isArray(v.entries)) {
			throw new Error('bad budget');
		}
		return v;
	} catch {
		// Unreadable: fail closed (no budget → every spend is confirmed).
		storage.removeItem(key(connectionId));
		return null;
	}
}

const live = (b: Stored, now: number) => b.entries.filter((e) => e.at > now - b.window_secs);
const usedWats = (entries: Entry[]) => entries.reduce((sum, e) => sum + BigInt(e.wats), 0n);

/** Set (or replace) the budget for one connection. `amount` is decimal webcash, > 0. */
export function setBudget(storage: BudgetStorage, connectionId: string, amount: string, windowSecs = DAY_SECS, now = nowSecs()): void {
	const wats = webcashToWats(amount);
	if (wats <= 0n) throw new Error('budget must be more than 0 webcash');
	if (!Number.isInteger(windowSecs) || windowSecs <= 0) throw new Error('budget window must be a positive number of seconds');
	const prev = read(storage, connectionId);
	const stored: Stored = {
		v: 1,
		rail: 'webcash',
		amount_wats: wats.toString(),
		window_secs: windowSecs,
		set_at: now,
		// Spending already done in the window still counts.
		entries: prev ? live(prev, now) : []
	};
	storage.setItem(key(connectionId), JSON.stringify(stored));
}

export function clearBudget(storage: BudgetStorage, connectionId: string): void {
	storage.removeItem(key(connectionId));
}

export function viewBudget(storage: BudgetStorage, connectionId: string, now = nowSecs()): BudgetView | null {
	const b = read(storage, connectionId);
	if (!b) return null;
	const cap = BigInt(b.amount_wats);
	const used = usedWats(live(b, now));
	return {
		amount: watsToWebcash(cap),
		window_secs: b.window_secs,
		used: watsToWebcash(used),
		remaining: watsToWebcash(cap > used ? cap - used : 0n)
	};
}

/** Drop budgets whose connection is no longer active (disconnected here or elsewhere). */
export function pruneBudgets(storage: BudgetStorage, activeIds: string[]): void {
	if (storage.length === undefined || !storage.key) return;
	const keep = new Set(activeIds);
	const stale: string[] = [];
	for (let i = 0; i < storage.length; i++) {
		const k = storage.key(i);
		if (k?.startsWith(KEY_PREFIX) && !keep.has(k.slice(KEY_PREFIX.length))) stale.push(k);
	}
	for (const k of stale) storage.removeItem(k);
}

/** The webcash amount (wats) of an op the budget can cover, or null. */
export function budgetedWats(op: Op, walletServer: string): bigint | null {
	if (op.kind !== 'Rail' || op.cmd.op !== 'PayWebcash' || op.cmd.inputs.length > 0) return null;
	if (!sameServer(op.cmd.server_url, walletServer)) return null;
	try {
		const wats = webcashToWats(op.cmd.amount);
		return wats > 0n ? wats : null;
	} catch {
		return null;
	}
}

export interface SpendBudgetDeps {
	storage: BudgetStorage;
	/** The wallet's own webcash server (runtime config `webcash_server_url`). */
	serverUrl: () => string;
	now?: () => number;
}

const nowSecs = () => Math.floor(Date.now() / 1000);

/** The host's `budget` hook: holds a covered spend against the connection's budget. */
export function spendBudget(deps: SpendBudgetDeps): SpendBudget {
	const now = deps.now ?? nowSecs;
	const write = (id: string, b: Stored) => deps.storage.setItem(key(id), JSON.stringify(b));
	return {
		async reserve(_app: ConnectedApp, connection: Connection, op: Op): Promise<BudgetReservation | null> {
			if (connection.revoked_at !== null) return null;
			const wats = budgetedWats(op, deps.serverUrl());
			if (wats === null) return null;
			const b = read(deps.storage, connection.id_hex);
			if (!b) return null;
			const t = now();
			const entries = live(b, t);
			if (usedWats(entries) + wats > BigInt(b.amount_wats)) return null;
			const id = crypto.randomUUID();
			// Held synchronously before resolving: a concurrent request sees it.
			write(connection.id_hex, { ...b, entries: [...entries, { id, at: t, wats: wats.toString(), state: 'held' }] });
			const update = (fn: (e: Entry[]) => Entry[]) => {
				const cur = read(deps.storage, connection.id_hex);
				if (cur) write(connection.id_hex, { ...cur, entries: fn(cur.entries) });
			};
			return {
				commit: async () => update((es) => es.map((e) => (e.id === id ? { ...e, state: 'spent' } : e))),
				cancel: async () => update((es) => es.filter((e) => e.id !== id))
			};
		}
	};
}
