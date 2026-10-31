// Hub-side CapToken postMessage bridge (GATE 7-CAP).
//
// Consumer CrossDomainExtroAdapter posts Op frames:
//   [0x02][reqId:16][scope_lv][op_lv4][token_lv4]
// Hub decodes, attaches CapToken onto the ExtroCommand, dispatches via the
// local bundled ExtroClient (PermissionAgent + H4 issuer pin from MintCapToken),
// and replies:
//   [0x03][reqId:16][status:1][body…]
// status 0x00 = Ok (body = JSON ExtroResponse); nonzero = denied/error (UTF-8 msg).

import type { ExtroClient } from './client';
import type { ExtroCommand, ExtroResponse } from './commands';

const FRAME = { REQUEST_SCOPES: 0x01, OP: 0x02, RESPONSE: 0x03 } as const;

export const DEFAULT_HUB_BRIDGE_ORIGINS = [
	'https://dev.extro.life',
	'https://dev.extro.network',
	'https://dev.weby.cash',
] as const;

export interface HubBridgeOptions {
	/** Origins allowed to present CapTokens. Fail-closed if empty. */
	allowedOrigins: readonly string[];
	/** Optional logger (defaults to console.debug in development). */
	log?: (msg: string, extra?: unknown) => void;
}

function u16be(n: number): Uint8Array {
	return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}
function u32be(n: number): Uint8Array {
	return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function concat(parts: Uint8Array[]): Uint8Array {
	const len = parts.reduce((a, p) => a + p.length, 0);
	const out = new Uint8Array(len);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
function readLv(buf: Uint8Array, offset: number): { value: Uint8Array; next: number } | null {
	if (offset + 2 > buf.length) return null;
	const n = (buf[offset] << 8) | buf[offset + 1];
	const start = offset + 2;
	const end = start + n;
	if (end > buf.length) return null;
	return { value: buf.slice(start, end), next: end };
}
function readLv4(buf: Uint8Array, offset: number): { value: Uint8Array; next: number } | null {
	if (offset + 4 > buf.length) return null;
	const n =
		((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
	const start = offset + 4;
	const end = start + n;
	if (end > buf.length) return null;
	return { value: buf.slice(start, end), next: end };
}

function extractBytes(data: unknown): Uint8Array | null {
	if (data instanceof Uint8Array) return data;
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (data && typeof data === 'object' && 'bytes' in data) {
		const b = (data as { bytes: unknown }).bytes;
		if (b instanceof Uint8Array) return b;
		if (b instanceof ArrayBuffer) return new Uint8Array(b);
	}
	return null;
}

function encodeResponse(reqId: Uint8Array, status: number, body: Uint8Array): Uint8Array {
	return concat([new Uint8Array([FRAME.RESPONSE]), reqId, new Uint8Array([status & 0xff]), body]);
}

function parseOp(frame: Uint8Array): {
	reqId: Uint8Array;
	scope: string;
	opBytes: Uint8Array;
	token: Uint8Array;
} | null {
	if (frame.length < 1 + 16 + 2 || frame[0] !== FRAME.OP) return null;
	const reqId = frame.slice(1, 17);
	let off = 17;
	const scopeLv = readLv(frame, off);
	if (!scopeLv) return null;
	off = scopeLv.next;
	const opLv = readLv4(frame, off);
	if (!opLv) return null;
	off = opLv.next;
	const tokLv = readLv4(frame, off);
	if (!tokLv) return null;
	return {
		reqId,
		scope: new TextDecoder().decode(scopeLv.value),
		opBytes: opLv.value,
		token: tokLv.value,
	};
}

export interface HubBridgeHandle {
	stop: () => void;
}

/**
 * Install the hub CapToken postMessage listener on `window`.
 * Returns a handle that removes the listener.
 */
export function installHubBridgeListener(
	client: ExtroClient,
	opts: HubBridgeOptions,
): HubBridgeHandle {
	const allowed = new Set(opts.allowedOrigins.map((o) => o.replace(/\/$/, '')));
	if (allowed.size === 0) {
		throw new Error('hub-bridge: allowedOrigins must be non-empty (fail-closed)');
	}
	const log = opts.log ?? ((msg: string, extra?: unknown) => {
		if (typeof console !== 'undefined') console.debug(`[hub-bridge] ${msg}`, extra ?? '');
	});

	const onMessage = (ev: MessageEvent) => {
		const origin = (ev.origin || '').replace(/\/$/, '');
		if (!allowed.has(origin)) {
			log('drop: origin not allowed', origin);
			return;
		}
		const raw = extractBytes(ev.data);
		if (!raw || raw[0] !== FRAME.OP) return;
		const parsed = parseOp(raw);
		if (!parsed) {
			log('drop: malformed Op frame');
			return;
		}
		if (!(parsed.token instanceof Uint8Array) || parsed.token.length === 0) {
			log('drop: empty CapToken');
			return;
		}
		const source = ev.source as Window | null;
		if (!source || typeof source.postMessage !== 'function') {
			log('drop: no event.source');
			return;
		}

		void (async () => {
			let status = 0x01;
			let body = new TextEncoder().encode('hub-bridge: dispatch failed');
			try {
				let command = JSON.parse(new TextDecoder().decode(parsed.opBytes)) as ExtroCommand;
				command = { ...command, cap_token: parsed.token };
				const response: ExtroResponse = await client.send(command);
				if (response.kind === 'Ok') {
					status = 0x00;
					body = new TextEncoder().encode(JSON.stringify(response));
				} else {
					status = 0x01;
					const msg =
						response.kind === 'Err'
							? `${response.code}: ${response.message}`
							: 'hub-bridge: unexpected response';
					body = new TextEncoder().encode(msg);
				}
			} catch (err) {
				status = 0x01;
				body = new TextEncoder().encode(err instanceof Error ? err.message : String(err));
			}
			const frame = encodeResponse(parsed.reqId, status, body);
			source.postMessage({ bytes: frame }, origin);
		})();
	};

	window.addEventListener('message', onMessage);
	log('installed', [...allowed]);
	return {
		stop: () => {
			window.removeEventListener('message', onMessage);
			log('stopped');
		},
	};
}
