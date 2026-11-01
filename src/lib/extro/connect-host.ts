// The wallet side of popup connect (ADR-0008): binds @extro/node's
// installWalletConnectHost to this app's node, release config and UI.
// Everything security-relevant (allowlist, opener, replay, tier ceiling,
// audience binding, confirm boundary) lives in the library and the node.

import {
	installWalletConnectHost,
	type ConnectedApp,
	type ConsentRequest,
	type Op,
	type WalletConnectHost
} from '@extro/node';
import { getExtroClient, getExtroScopeTier } from './index';
import { getRuntimeConfig } from './release-config';

export interface ConnectPrompts {
	consent: (request: ConsentRequest) => Promise<boolean>;
	confirm: (app: ConnectedApp, op: Op) => Promise<boolean>;
}

/** Serve the opener; `null` when this page was not opened by a connected app's popup call. */
export function startConnectHost(prompts: ConnectPrompts): WalletConnectHost | null {
	return installWalletConnectHost({
		client: getExtroClient(),
		config: getRuntimeConfig(),
		scopeTier: getExtroScopeTier,
		consent: prompts.consent,
		confirm: prompts.confirm
	});
}

/** One line per field of a value-moving op, for the confirm screen (bytes shown by length). */
export function describeOp(op: Op): { title: string; fields: [string, string][] } {
	const cmd = (op as { cmd?: Record<string, unknown> }).cmd ?? {};
	const name = typeof cmd.op === 'string' ? cmd.op : op.kind;
	const fields: [string, string][] = [];
	for (const [key, value] of Object.entries(cmd)) {
		if (key === 'op') continue;
		fields.push([key, render(value)]);
	}
	return { title: `${op.kind} · ${name}`, fields };
}

function render(value: unknown): string {
	if (value instanceof Uint8Array) return `${value.length} bytes`;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value === null || value === undefined) return '—';
	return JSON.stringify(value, (_k, v) => (v instanceof Uint8Array ? `${v.length} bytes` : v));
}
