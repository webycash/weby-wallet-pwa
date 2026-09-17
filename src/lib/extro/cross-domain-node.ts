// Cross-domain extro.network wallet adapter (CapToken bearer).
//
// Hub origin owns the unlocked wallet + PermissionAgent. Consumer origins
// present a minted CapToken (rkyv bytes) on every dispatch via postMessage.
// H4 issuer-pin is applied on the hub when MintCapToken runs.
//
// Wire: demo-compatible frames from extro-node examples/crossdomain_wasm_consumer
//   RequestScopes  [0x01][reqId:16][origin_lv][scopes_lv]
//   Op             [0x02][reqId:16][scope_lv][op_lv4][token_lv4]
//   Response       [0x03][reqId:16][status:1][body…]

import type { ExtroAdapter } from './client';
import type { ExtroCommand, ExtroResponse } from './commands';

export interface CrossDomainOptions {
	/** Hub origin that owns the wallet, e.g. `https://dev.weby.cash`. */
	bridgeUrl: string;
	/** rkyv-encoded CapToken bytes the caller presents. */
	capToken: Uint8Array;
	/**
	 * Hub window/iframe that listens for CapToken Op frames. Required for
	 * postMessage dispatch; without it boot refuses (no silent mock).
	 */
	hubWindow?: Window | null;
	/** Explicit acknowledgement this is the CapToken path (not bundled). */
	acknowledgePreProduction: boolean;
}

const FRAME = { REQUEST_SCOPES: 0x01, OP: 0x02, RESPONSE: 0x03 } as const;

function u16(n: number): Uint8Array {
	return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}
function u32(n: number): Uint8Array {
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
function lv(s: string): Uint8Array {
	const b = new TextEncoder().encode(s);
	return concat([u16(b.length), b]);
}
function lv4(b: Uint8Array): Uint8Array {
	return concat([u32(b.length), b]);
}
function rid(): Uint8Array {
	const id = new Uint8Array(16);
	crypto.getRandomValues(id);
	return id;
}

function encodeOp(scope: string, opBytes: Uint8Array, token: Uint8Array): Uint8Array {
	const reqId = rid();
	return concat([
		new Uint8Array([FRAME.OP]),
		reqId,
		lv(scope),
		lv4(opBytes),
		lv4(token),
	]);
}

function decodeResponse(bytes: Uint8Array): { status: number; body: Uint8Array } {
	if (bytes.length < 1 + 16 + 1 || bytes[0] !== FRAME.RESPONSE) {
		throw new Error('cross-domain: malformed Response frame');
	}
	return { status: bytes[17], body: bytes.slice(18) };
}

/**
 * Scope string presented with the CapToken for this command. Wallet reads use
 * WalletRead(pgp); other ops use Full until finer mapping is productized.
 */
function scopeForCommand(command: ExtroCommand): string {
	if (command.op.kind === 'Wallet') {
		const op = command.op.cmd.op;
		if (op === 'DeriveIdentity' || op === 'ListSummaries') {
			return 'WalletRead(pgp)';
		}
	}
	if (command.op.kind === 'Social') return 'Social(Publish)';
	return 'Full';
}

export class CrossDomainExtroAdapter implements ExtroAdapter {
	readonly mode = 'cross-domain' as const;
	private readonly opts: CrossDomainOptions;
	private hubOrigin = '';

	constructor(opts: CrossDomainOptions) {
		this.opts = opts;
	}

	async boot(): Promise<void> {
		if (!this.opts.acknowledgePreProduction) {
			throw new Error(
				'cross-domain CapToken mode requires acknowledgePreProduction:true ' +
					'(hub must have minted a CapToken with MintCapToken / H4 issuer pin).',
			);
		}
		if (!this.opts.hubWindow) {
			throw new Error(
				'cross-domain CapToken mode requires hubWindow (popup/iframe to the hub origin).',
			);
		}
		if (!(this.opts.capToken instanceof Uint8Array) || this.opts.capToken.length === 0) {
			throw new Error('cross-domain CapToken mode requires a non-empty capToken');
		}
		this.hubOrigin = new URL(this.opts.bridgeUrl).origin;
	}

	async dispatch(command: ExtroCommand): Promise<ExtroResponse> {
		const hub = this.opts.hubWindow;
		if (!hub) throw new Error('cross-domain: hubWindow missing (call boot first)');

		// Carry the typed ExtroCommand as JSON for the hub to re-encode via
		// extro_encode_command — CapToken gate still runs on the hub WASM.
		const opBytes = new TextEncoder().encode(JSON.stringify(command));
		const frame = encodeOp(scopeForCommand(command), opBytes, this.opts.capToken);
		const reqId = frame.slice(1, 17);

		const body = await new Promise<Uint8Array>((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error('cross-domain: hub response timeout'));
			}, 30_000);
			const onMsg = (ev: MessageEvent) => {
				if (ev.origin !== this.hubOrigin) return;
				const raw =
					ev.data instanceof Uint8Array
						? ev.data
						: ev.data?.bytes instanceof Uint8Array
							? ev.data.bytes
							: null;
				if (!raw || raw[0] !== FRAME.RESPONSE) return;
				const gotId = raw.slice(1, 17);
				if (!reqId.every((b, i) => b === gotId[i])) return;
				cleanup();
				resolve(raw);
			};
			const cleanup = () => {
				clearTimeout(timer);
				window.removeEventListener('message', onMsg);
			};
			window.addEventListener('message', onMsg);
			hub.postMessage({ bytes: frame }, this.hubOrigin);
		});

		const decoded = decodeResponse(body);
		if (decoded.status !== 0x00) {
			const msg = new TextDecoder().decode(decoded.body);
			return {
				kind: 'Err',
				request_id: reqId,
				code: 'PermissionDenied',
				message: msg || 'cap-token denied',
			};
		}
		// Hub returns JSON ExtroResponse bytes on success.
		try {
			const parsed = JSON.parse(new TextDecoder().decode(decoded.body)) as ExtroResponse;
			return parsed;
		} catch {
			return {
				kind: 'Ok',
				request_id: reqId,
				body: { kind: 'Empty' },
			};
		}
	}
}
