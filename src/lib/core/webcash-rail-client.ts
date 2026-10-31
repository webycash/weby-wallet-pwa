// The ONE webcash-rail client in the wallet's TypeScript. TS never talks to a
// webcash rail (`webcash.org` on mainnet, webycash-server on dev) itself: every
// rail read goes through extro-node's `Rail(WebcashTokenStatus)` op, which
// speaks the rail protocol via webylib `server_client::wire` (CORS-simple
// text/plain POSTs, strict typed health_check parsing, fail-closed). Value-
// moving rail ops (`ReserveWebcash`, …) are extro-node ops as well.
// `webcash-rail-guard.test.ts` fails the build if any TS references a rail
// endpoint or the shipped WASM carries a JSON content-type.
//
// This module only validates inputs, dispatches through an injected op
// (default: `$lib/extro/rail`), and strictly projects the typed response;
// callers never get a guessed answer.

import type { RailOutcome } from '$lib/extro/rail';
import type { WebcashTokenState } from '@extro/node';

export type WebcashRailOp = 'health_check';

export type WebcashRailErrorKind = 'bad_input' | 'unsupported' | 'node' | 'bad_response';

export class WebcashRailError extends Error {
	readonly op: WebcashRailOp;
	readonly kind: WebcashRailErrorKind;

	constructor(op: WebcashRailOp, kind: WebcashRailErrorKind, detail: string) {
		super(`webcash rail ${op}: ${kind}: ${detail}`);
		this.name = 'WebcashRailError';
		this.op = op;
		this.kind = kind;
	}
}

/** Tri-state rail view of one public token. `unknown` = never issued (`spent:null`). */
export type RailTokenStatus =
	| { status: 'unspent'; amount: string | null }
	| { status: 'spent'; amount: string | null }
	| { status: 'unknown' };

const PUBLIC_TOKEN = /^e[0-9]+(?:\.[0-9]{1,8})?:public:[0-9a-f]{64}$/i;

export function isPublicWebcash(token: string): boolean {
	return PUBLIC_TOKEN.test(token);
}

/**
 * The extro-node op that reads token status on the rail (injected; the default
 * dispatches `Rail(WebcashTokenStatus)` through the extro facade).
 */
export type WebcashTokenStatusOp = (args: {
	serverUrl: string;
	publicTokens: string[];
}) => Promise<RailOutcome<{ kind: 'WebcashTokenStatuses'; statuses: WebcashTokenState[] }>>;

export const extroWebcashTokenStatus: WebcashTokenStatusOp = async (args) =>
	(await import('$lib/extro/rail')).webcashTokenStatus(args);

export interface WebcashRailClient {
	/** Rail `health_check` for public tokens; one status per requested token. */
	healthCheck(publicTokens: readonly string[]): Promise<Record<string, RailTokenStatus>>;
}

export interface ExtroWebcashRailOptions {
	/** Rail base URL (`runtime-config.webcash_server_url`). */
	baseUrl: string;
	tokenStatus?: WebcashTokenStatusOp;
}

export class ExtroWebcashRailClient implements WebcashRailClient {
	private readonly base: string;
	private readonly tokenStatus: WebcashTokenStatusOp;

	constructor(opts: ExtroWebcashRailOptions) {
		let parsed: URL;
		try {
			parsed = new URL(opts.baseUrl);
		} catch {
			throw new WebcashRailError('health_check', 'bad_input', `invalid rail base url ${opts.baseUrl}`);
		}
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
			throw new WebcashRailError('health_check', 'bad_input', `unsupported rail scheme ${parsed.protocol}`);
		}
		this.base = opts.baseUrl.replace(/\/+$/, '');
		this.tokenStatus = opts.tokenStatus ?? extroWebcashTokenStatus;
	}

	async healthCheck(publicTokens: readonly string[]): Promise<Record<string, RailTokenStatus>> {
		if (publicTokens.length === 0) {
			throw new WebcashRailError('health_check', 'bad_input', 'no tokens');
		}
		for (const t of publicTokens) {
			// Never let a secret leave the wallet through a lookup.
			if (!isPublicWebcash(t)) throw new WebcashRailError('health_check', 'bad_input', 'not a public webcash token');
		}
		const res = await this.tokenStatus({ serverUrl: this.base, publicTokens: [...publicTokens] });
		if (res.state === 'pending') {
			throw new WebcashRailError('health_check', 'unsupported', 'extro-node build lacks WebcashTokenStatus');
		}
		if (res.state === 'error') throw new WebcashRailError('health_check', 'node', res.message);
		const { statuses } = res.value;
		if (!Array.isArray(statuses) || statuses.length !== publicTokens.length) {
			throw new WebcashRailError('health_check', 'bad_response', 'one status per requested token expected');
		}
		const out: Record<string, RailTokenStatus> = {};
		publicTokens.forEach((t, i) => {
			const row = statuses[i];
			if (row?.public_token !== t) {
				throw new WebcashRailError('health_check', 'bad_response', 'status row does not match the requested token');
			}
			out[t] = projectRow(row);
		});
		return out;
	}
}

function projectRow(row: WebcashTokenState): RailTokenStatus {
	const amount = row.amount ?? null;
	if (amount !== null && typeof amount !== 'string') {
		throw new WebcashRailError('health_check', 'bad_response', 'amount is not string|null');
	}
	switch (row.status) {
		case 'unknown':
			return { status: 'unknown' };
		case 'unspent':
		case 'spent':
			return { status: row.status, amount };
		default:
			throw new WebcashRailError('health_check', 'bad_response', `unexpected status ${String(row.status)}`);
	}
}
