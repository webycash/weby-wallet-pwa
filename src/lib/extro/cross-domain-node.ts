// Cross-domain extro.network wallet adapter.
//
// Targets a wallet bridge hosted on extro.network: the PWA presents a signed
// CapToken and posts rkyv-encoded `ExtroCommand` bytes to the bridge, which
// dispatches them against the user's extro.network-resident node and returns
// the framed `ExtroResponse`.
//
// NOT PRODUCTION-READY. This mode depends on the extro-node H4 CapToken
// issuer-pin, which is NOT YET APPLIED. Until the issuer-pin lands, a
// cross-domain caller cannot prove its authority and the bridge must reject it
// (`ErrorCode::PermissionDenied`). The same-realm BUNDLED mode is the shipping
// default; this adapter exists so the cross-domain shape is in place, and is
// gated behind an explicit opt-in.
//
// DEFERRED (same as bundled): the rkyv command codec ({@link ./codec}).

import type { ExtroAdapter } from './client';
import type { ExtroCommand, ExtroResponse } from './commands';

export interface CrossDomainOptions {
	/** Bridge base URL, e.g. `https://extro.network`. */
	bridgeUrl: string;
	/** rkyv-encoded CapToken bytes the caller presents. */
	capToken: Uint8Array;
	/**
	 * Explicit acknowledgement that cross-domain is pre-production. Without it,
	 * the adapter refuses to boot — a guard so this mode is never shipped as the
	 * default by accident.
	 */
	acknowledgePreProduction: boolean;
}

export class CrossDomainExtroAdapter implements ExtroAdapter {
	readonly mode = 'cross-domain' as const;
	private readonly opts: CrossDomainOptions;

	constructor(opts: CrossDomainOptions) {
		this.opts = opts;
	}

	async boot(): Promise<void> {
		if (!this.opts.acknowledgePreProduction) {
			throw new Error(
				'cross-domain extro.network mode is not production-ready: it depends on ' +
					'the extro-node H4 CapToken issuer-pin (not yet applied). Pass ' +
					'acknowledgePreProduction:true to use it knowingly, or use the bundled mode.'
			);
		}
		// No persistent connection to establish; the bridge is stateless-per-call.
	}

	async dispatch(_command: ExtroCommand): Promise<ExtroResponse> {
		// Wiring the POST + rkyv codec is deferred together with the issuer-pin.
		throw new Error(
			'cross-domain dispatch is not wired: blocked on the extro-node H4 CapToken ' +
				'issuer-pin and the rkyv ExtroCommand codec. Use the mock or bundled adapter.'
		);
	}
}
