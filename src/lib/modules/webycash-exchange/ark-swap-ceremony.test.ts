/**
 * Protocol-level wiring of the settle ceremony (both roles). Every network
 * edge is mocked; the ceremony crypto runs in the real extro-node WASM
 * (`Op::Ark`) over the per-swap tweaked cross-backend vector extro-node ships
 * (audit C1), so the seller's aggregation is checked against Rust output.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { arkCeremonyVector, bootArkNode } from '$lib/ark/ark-node.testkit';

const V = arkCeremonyVector();
/** The vector under the field names this suite reads. */
const vector = {
	referee_pubkey_hex: V.referee_pubkey_hex,
	provider_pubkey_hex: V.provider_pubkey_hex,
	owner_q_xonly_hex: V.owner_q_xonly_hex,
	sighash_hex: V.sighashes_hex,
	referee_nonce_hex: V.referee_nonces_hex,
	provider_nonce_hex: V.provider_nonces_hex,
	referee_partial_hex: V.referee_partials_hex,
	provider_partial_hex: V.provider_partials_hex,
	signature_hex: V.signatures_hex.join('')
};
const SWAP_ID = V.swap_id;
const REQUEST_COMMITMENT_HEX = V.request_commitment_hex;

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const ORDER_ID = '0f'.repeat(16);
const SELLER_FP = 'ab'.repeat(20);
const PROVIDER_FP = 'cd'.repeat(20);
const LOCKED = `${'33'.repeat(32)}:0`;
const CFG = {
	ark_enabled: true,
	ark_network: 'signet',
	ark_signer_pk_hex: '44'.repeat(32),
	ark_info_digest_hex: '55'.repeat(32),
	ark_unilateral_exit_delay: 172544,
	ark_asp_url: 'https://asp.invalid',
	referee_url: 'https://referee.invalid',
	referee_vk_hex: '66'.repeat(32),
	ark_checkpoint_tapscript_hex: '51'
};
const CAPS = [
	'ark-prepare-policies-v1',
	'hex-sighash-v1',
	'settle-ceremony-v1',
	'sighash-bundle-v1',
	'release-pull-v1',
	'insert-pull-v1'
];

const state = vi.hoisted(() => ({
	node: null as null | { send(req: unknown): Promise<unknown> },
	refereePubkey: null as unknown,
	msgs: [] as unknown[],
	material: null as unknown,
	walletCreate: vi.fn(),
	balance: '0',
	q: '',
	refundHash: '',
	initFacts: null as unknown,
	precheck: vi.fn(async () => ({ swap_id: SWAP_ID, bearer: { ok: true }, provider: { ok: true } })),
	legIssued: vi.fn(async () => ({ amount: '100' })),
	submitPrecheck: vi.fn(async () => undefined),
	coop: vi.fn()
}));
vi.mock('$lib/ark/coop-refund', () => ({ coopRefundAggregate: state.coop }));
vi.mock('./bearer-precheck', () => ({
	awaitRefereePrecheck: state.precheck,
	assertBearerLegIssued: state.legIssued,
	submitBearerPrecheck: state.submitPrecheck,
	railTokenStatus: async () => ({ status: 'unspent', amount: '1' })
}));

vi.mock('$lib/extro/release-config', async () => ({
	getRuntimeConfig: () => CFG,
	refereeAvailable: (await vi.importActual<typeof import('@extro/node')>('@extro/node')).refereeAvailable
}));
vi.mock('$lib/extro/self-identity', () => ({
	getSelfIdentity: async () => ({ fingerprintHex: PROVIDER_FP, verifyingKey: hex('77'.repeat(32)) })
}));
vi.mock('$lib/ark/ark-view', () => ({
	loadArkOverview: async () => ({ arkAddress: 'tark1provider', offchainSats: state.balance })
}));
vi.mock('$lib/extro', () => ({
	getExtroClient: () => ({
		send: async (req: { op: { kind: string; cmd: { op: string } } }) => {
			if (req.op.kind === 'Ark' || req.op.kind === 'Exchange') return state.node!.send(req);
			if (req.op.cmd.op === 'SendProviderOffer') return { kind: 'Ok', body: { kind: 'SwapMsgSent', delivered: true } };
			if (req.op.cmd.op === 'InspectSwapPrepare') return { kind: 'Ok', body: { kind: 'SwapPrepareTerms', terms: providerTerms() } };
			throw new Error(`unexpected op ${req.op.cmd.op}`);
		}
	})
}));
vi.mock('./referee-client', () => ({
	HttpRefereeClient: class {
		async pubkey() {
			if (!state.refereePubkey) throw new Error('referee down');
			return state.refereePubkey;
		}
	}
}));
vi.mock('./accept-run-swap', () => ({
	fetchSwapMsgs: async () => ({
		provider: state.msgs.length ? state.msgs.shift() : state.material
	}),
	probeProviderMaterial: async () => ({ ok: true }),
	providerMaterialFromWire: (m: unknown, payload: Uint8Array) => ({ wire: m, payload })
}));
vi.mock('./swap-facts', async (orig) => ({
	bearerAssetFor: (await orig<typeof import('./swap-facts')>()).bearerAssetFor,
	assertLegMatchesOrder: (await orig<typeof import('./swap-facts')>()).assertLegMatchesOrder,
	bearerLegFromWallet: async () => ({
		publicTokenHash: hex('e1'.repeat(32)),
		bearerAmount: '100',
		fillAmountRaw: 100n,
		asset: { family: 'Webcash' }
	}),
	buildSwapInitiateFacts: (input: unknown) => {
		state.initFacts = input;
		return { facts: 'two-proof' };
	}
}));
vi.mock('./swap-prepare', () => ({
	signSwapPrepare: async () => ({ signed: new Uint8Array([1]), requestCommitment: hex(REQUEST_COMMITMENT_HEX) }),
	countersignSwapPrepare: async () => ({ signed: new Uint8Array([2]), requestCommitment: hex(REQUEST_COMMITMENT_HEX) }),
	relaySwapPrepareSignature: async () => true,
	fetchSwapPrepareInbox: async () => ({
		providerSigned: new Uint8Array([2]),
		bearerSellerSigned: new Uint8Array([1]),
		signedResponse: new Uint8Array([3])
	}),
	verifySwapPreparedResponse: async () => prepared()
}));
vi.mock('./accept-prepare', async (orig) => ({
	...(await orig<typeof import('./accept-prepare')>()),
	submitDualSignedPrepare: async () => prepared()
}));
vi.mock('$lib/ark/swap-contract', () => ({
	deriveVerifiedArkContractPlan: async () => ({
		swapId: SWAP_ID,
		requestCommitment: hex(REQUEST_COMMITMENT_HEX),
		amountSats: 1000n,
		aggregateOwnerKey: hex(state.q)
	}),
	buildArkSwapContract: (_c: unknown, plan: unknown) => ({ plan, address: 'tark1contract', tapTree: new Uint8Array([9]) }),
	fundArkSwapContract: async () => ({ arkTxId: '33'.repeat(32) })
}));
// The live operator attestation (release pins + extro-node canonical digest)
// is unit-tested in operator.test.ts; here the swap only needs its result.
vi.mock('$lib/ark/operator', () => ({
	verifiedArkOperator: async () => ({ operator: { network: 'signet' } })
}));
vi.mock('$lib/ark/funded-ref', () => ({
	resolveFundedLockedRef: async () => LOCKED,
	assertFundedLockedRef: async () => undefined
}));
vi.mock('$lib/ark/settle-tx', () => ({
	fundingRefsFromSpends: (_c: unknown, lockedRef: string) => ({
		lockedRef,
		txSettleHashHex: vector.sighash_hex,
		txRefundHashHex: state.refundHash,
		settle: { kind: 'settle', lockedRef, bundleHex: vector.sighash_hex },
		refund: { kind: 'refund', lockedRef, bundleHex: state.refundHash }
	})
}));
vi.mock('@arkade-os/sdk', () => ({
	Wallet: { create: state.walletCreate },
	RestIndexerProvider: class {}
}));

import { runSwapRole, type SwapProgress } from './ark-swap-protocol';
import { memoryContractJournal, type ContractJournalBackend } from '$lib/ark/contract-journal';

function prepared() {
	return {
		swapId: SWAP_ID,
		requestCommitment: hex(REQUEST_COMMITMENT_HEX),
		idempotencyKey: hex('99'.repeat(16)),
		expiresAtUnix: 0,
		signedResponse: new Uint8Array([3]),
		refereeMusig2Pubshare: vector.referee_pubkey_hex,
		refereeSettleNoncePub: vector.referee_nonce_hex,
		refereeRefundNoncePub: vector.referee_nonce_hex
	};
}

const offer = () => ({
	order_id: hex(ORDER_ID),
	provider_fp: hex(PROVIDER_FP),
	provider_pgp_pubkey: hex('77'.repeat(32)),
	provider_musig2_pubkey: vector.provider_pubkey_hex,
	settle_nonce_pub: vector.provider_nonce_hex,
	refund_nonce_pub: vector.provider_nonce_hex,
	provider_cancel_pubkey_hex: '77'.repeat(32),
	locked_ref: 'offer:tark1provider',
	tx_settle_hash_hex: '',
	tx_refund_hash_hex: ''
});
const fundedMaterial = () => ({
	...offer(),
	locked_ref: LOCKED,
	tx_settle_hash_hex: vector.sighash_hex,
	tx_refund_hash_hex: state.refundHash
});

function providerTerms() {
	const id32 = new Uint8Array(32);
	id32.set(hex(ORDER_ID), 16);
	return {
		order_id: id32,
		signed_order_commitment_sha256: hex('01'.repeat(32)),
		fill_amount_raw: 100n, // = fillAmountRawFor(order); the provider now checks it
		bearer_asset: { family: 'Webcash' },
		parties: {
			provider_fp: PROVIDER_FP,
			provider_pgp_pubkey_hex: '77'.repeat(32),
			bearer_seller_fp: SELLER_FP,
			bearer_seller_pgp_pubkey_hex: '78'.repeat(32),
			provider_musig2_pubkey: vector.provider_pubkey_hex,
			provider_cancel_pubkey_hex: '77'.repeat(32),
			bearer_seller_cancel_pubkey_hex: '78'.repeat(32)
		},
		provider_nonces: { settle_nonce_pub: vector.provider_nonce_hex, refund_nonce_pub: vector.provider_nonce_hex },
		ark_network: CFG.ark_network,
		ark_operator_signer_pk: hex(CFG.ark_signer_pk_hex),
		ark_operator_info_digest: hex(CFG.ark_info_digest_hex),
		ark_unilateral_exit_delay: BigInt(CFG.ark_unilateral_exit_delay),
		ark_amount_sats: 1000n,
		provider_ark_destination: 'tark1provider',
		bearer_seller_ark_destination: 'tark1seller',
		idempotency_key: hex('99'.repeat(16)),
		nonce: hex('02'.repeat(32)),
		expires_at_unix: Math.floor(Date.now() / 1000) + 600
	};
}

const order = {
	id: ORDER_ID,
	pair: { base: 'Webcash', quote: 'BitcoinArk' },
	side: 'buy',
	price: 10,
	amount: 100,
	makerFingerprint: PROVIDER_FP,
	makerVk: '77'.repeat(32),
	expiresAt: Math.floor(Date.now() / 1000) + 3600,
	observedAt: 0,
	source: 'mock',
	signedCommitment: ''
} as never;

let journal = memoryContractJournal();
const fast = {
	stepTimeoutMs: 200,
	fundingWaitMs: 200,
	intervalMs: 5,
	maxBearerWebcash: '1000', // fixture bearer face is e100; production default cap is "1"
	get contractJournal(): ContractJournalBackend {
		return journal;
	}
};
const phases = (log: SwapProgress[]) => log.map((p) => p.phase);

beforeAll(async () => {
	state.node = (await bootArkNode()) as never;
});

beforeEach(() => {
	journal = memoryContractJournal();
	state.refereePubkey = { ed25519_pubkey_hex: CFG.referee_vk_hex, musig2_pubshare_hex: vector.referee_pubkey_hex, capabilities: CAPS };
	state.msgs = [];
	state.material = null;
	state.walletCreate.mockReset();
	state.balance = '0';
	state.q = vector.owner_q_xonly_hex;
	state.refundHash = 'a5'.repeat(32);
	state.initFacts = null;
	state.precheck.mockReset();
	state.precheck.mockResolvedValue({ swap_id: SWAP_ID, bearer: { ok: true }, provider: { ok: true } });
	state.legIssued.mockReset();
	state.legIssued.mockResolvedValue({ amount: '100' });
	state.submitPrecheck.mockReset();
	state.submitPrecheck.mockResolvedValue(undefined);
	state.coop.mockReset();
	state.coop.mockRejectedValue(new Error('coop referee unreachable (test default)'));
});

describe('provider side', () => {
	it('never funds until the referee pre-check passes for both legs', async () => {
		state.balance = '1000000';
		state.material = offer();
		state.precheck.mockRejectedValue(
			new Error('REFEREE_PRECHECK_PENDING: the referee has not attested a passing pre-check (bearer: H unknown to rail)')
		);
		const log: SwapProgress[] = [];
		const out = await runSwapRole('provider', order, SELLER_FP, { ...fast, onProgress: (p) => log.push(p) });
		expect(out.phase).toBe('gate');
		expect(out.gate).toMatch(/^REFEREE_PRECHECK_PENDING/);
		expect(phases(log)).not.toContain('funding');
		expect(state.walletCreate).not.toHaveBeenCalled();
		expect(state.precheck).toHaveBeenCalledWith(expect.objectContaining({ swapId: SWAP_ID }));
	});

	it('refuses to fund when the signed terms cannot be persisted durably', async () => {
		state.balance = '1000000';
		state.material = offer();
		const broken: ContractJournalBackend = {
			put: async () => {
				throw new Error('QuotaExceededError');
			},
			get: async () => null,
			keys: async () => []
		};
		const log: SwapProgress[] = [];
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			contractJournal: broken,
			onProgress: (p) => log.push(p)
		});
		expect(out.phase).toBe('gate');
		expect(out.gate).toMatch(/^ARK_CONTRACT_NOT_PERSISTED/);
		expect(phases(log)).not.toContain('funding');
		expect(state.walletCreate).not.toHaveBeenCalled();
	});

	it('persists the exact signed terms + referee response before funding', async () => {
		state.balance = '1000000';
		state.material = offer();
		state.precheck.mockRejectedValue(new Error('REFEREE_PRECHECK_PENDING: x'));
		await runSwapRole('provider', order, SELLER_FP, fast);
		const raw = journal.map.get(`contract:${SWAP_ID}`);
		expect(raw).toBeTruthy();
		const rec = JSON.parse(raw!);
		expect(rec).toMatchObject({ role: 'provider', contractAddress: 'tark1contract', arkAmountSats: '1000' });
		expect(rec.providerSignedHex.length).toBeGreaterThan(0);
		expect(rec.refereeSignedResponseHex.length).toBeGreaterThan(0);
	});

	it('stops BEFORE funding when the referee is the current (capability-less) build', async () => {
		state.refereePubkey = { ed25519_pubkey_hex: CFG.referee_vk_hex, musig2_pubshare_hex: vector.referee_pubkey_hex, referee_version: 'old' };
		state.balance = '1000000';
		state.material = offer();
		const log: SwapProgress[] = [];
		const out = await runSwapRole('provider', order, SELLER_FP, { ...fast, onProgress: (p) => log.push(p) });
		expect(out.phase).toBe('gate');
		expect(out.gate).toMatch(/^ARK_REFEREE_CEREMONY_UNAVAILABLE/);
		expect(out.contractAddress).toBe('tark1contract');
		expect(phases(log)).not.toContain('funding');
		expect(state.walletCreate).not.toHaveBeenCalled();
	});

	it('stops before funding when KeyAgg(referee, provider) is not the contract key', async () => {
		state.balance = '1000000';
		state.material = offer();
		state.q = '11'.repeat(32);
		const out = await runSwapRole('provider', order, SELLER_FP, fast);
		expect(out.gate).toMatch(/^ARK_SETTLE_CEREMONY_INVALID.*owner key/);
		expect(state.walletCreate).not.toHaveBeenCalled();
	});

	it('funds, binds material to Q, and — with no delivery channel — stops at RELEASE_PENDING without signing', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const sign = vi.fn(async () => vector.provider_partial_hex);
		const log: SwapProgress[] = [];
		const out = await runSwapRole('provider', order, SELLER_FP, { ...fast, providerPartialSigner: sign, onProgress: (p) => log.push(p) });
		expect(out.gate).toMatch(/^ARK_SETTLE_RELEASE_PENDING/);
		expect(phases(log)).toEqual(expect.arrayContaining(['ceremony-ready', 'funding', 'funded', 'material-sent']));
		expect(sign).not.toHaveBeenCalled();
	});

	it('signs in-WASM, self-verifies and delivers when a transport is wired', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const sign = vi.fn(async () => vector.provider_partial_hex);
		const deliverProviderPartial = vi.fn(async () => undefined);
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			providerPartialSigner: sign,
			settleTransport: { deliverProviderPartial }
		});
		expect(out.phase).toBe('settle-partial-delivered');
		expect(deliverProviderPartial).toHaveBeenCalledWith({
			slot: 0,
			orderIdHex: ORDER_ID,
			sellerFpHex: SELLER_FP,
			sellerVkHex: '78'.repeat(32),
			swapId: SWAP_ID,
			lockedRef: LOCKED,
			partialHex: vector.provider_partial_hex
		});
	});

	it('after delivery opens the inserted bearer secret and claims it', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const insertBearer = vi.fn(async () => undefined);
		const outcomes = [null, { kind: 'insert' as const, webcash: 'e100:secret:' + 'ab'.repeat(32) }];
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			providerPartialSigner: async () => vector.provider_partial_hex,
			settleTransport: {
				deliverProviderPartial: async () => undefined,
				awaitProviderOutcome: async () => outcomes.shift() ?? null,
				insertBearer
			}
		});
		expect(out.phase).toBe('bearer-claimed');
		expect(insertBearer).toHaveBeenCalledWith('e100:secret:' + 'ab'.repeat(32));
	});

	it('on a referee abort aggregates the refund under Q and submits it', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.refundHash = vector.sighash_hex; // the cross-impl vector message
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const sessions: string[] = [];
		const submitSpend = vi.fn(async () => 'f0'.repeat(32));
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			providerPartialSigner: async (req) => {
				sessions.push(req.session);
				return vector.provider_partial_hex;
			},
			settleTransport: {
				deliverProviderPartial: async () => undefined,
				awaitProviderOutcome: async () => ({
					kind: 'refund',
					refereePartialHex: vector.referee_partial_hex
				}),
				submitSpend
			}
		});
		expect(out.phase).toBe('refunded');
		expect(out.arkTxid).toBe('f0'.repeat(32));
		expect(sessions).toEqual(['settle', 'refund']);
		expect(submitSpend).toHaveBeenCalledWith(
			expect.objectContaining({
				spend: expect.objectContaining({ kind: 'refund' }),
				aggregateSigsHex: vector.signature_hex
			})
		);
	});

	it('abort (no referee outcome) → coop-refund-v1 with the committed terms, then submits the refund', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		state.coop.mockResolvedValue({ signaturesHex: 'c0'.repeat(128), phase: 'canceled', fillId: 'coop:x', inputs: {} });
		const submitSpend = vi.fn(async () => 'f1'.repeat(32));
		const log: SwapProgress[] = [];
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			settleWaitMs: 30,
			onProgress: (p: SwapProgress) => log.push(p),
			providerPartialSigner: async () => vector.provider_partial_hex,
			settleTransport: {
				deliverProviderPartial: async () => undefined,
				awaitProviderOutcome: async () => null,
				submitSpend
			}
		} as never);
		expect(out.phase).toBe('refunded');
		expect(out.arkTxid).toBe('f1'.repeat(32));
		expect(state.coop).toHaveBeenCalledTimes(1);
		const [input] = state.coop.mock.calls[0] as unknown as [Record<string, unknown>];
		expect(input).toMatchObject({ refereeUrl: CFG.referee_url, orderIdHex: ORDER_ID, slot: expect.any(Number) });
		expect(input.expectCancelPubkeyHex).toMatch(/^[0-9a-f]{64}$/i);
		expect(input.requestCommitmentHex).toMatch(/^[0-9a-f]{64}$/i);
		expect(submitSpend).toHaveBeenCalledWith(
			expect.objectContaining({ spend: expect.objectContaining({ kind: 'refund' }), aggregateSigsHex: 'c0'.repeat(128) })
		);
	});

	it('abort with coop disabled or failing keeps the RELEASE_PENDING gate and never submits', async () => {
		for (const coopRefund of [false, undefined] as const) {
			state.balance = '1000000';
			state.walletCreate.mockResolvedValue({});
			state.msgs = [offer()];
			state.material = fundedMaterial();
			journal = memoryContractJournal();
			const submitSpend = vi.fn(async () => 'f1'.repeat(32));
			const out = await runSwapRole('provider', order, SELLER_FP, {
				...fast,
				settleWaitMs: 30,
				coopRefund,
				providerPartialSigner: async () => vector.provider_partial_hex,
				settleTransport: {
					deliverProviderPartial: async () => undefined,
					awaitProviderOutcome: async () => null,
					submitSpend
				}
			} as never);
			expect(out.gate ?? out.message).toMatch(/RELEASE_PENDING/);
			expect(submitSpend).not.toHaveBeenCalled();
		}
	});

	it('refuses to sign a refund over a forged referee partial', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.refundHash = vector.sighash_hex;
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const submitSpend = vi.fn(async () => 'f0'.repeat(32));
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			providerPartialSigner: async () => vector.provider_partial_hex,
			settleTransport: {
				deliverProviderPartial: async () => undefined,
				awaitProviderOutcome: async () => ({
					kind: 'refund',
					refereePartialHex: vector.provider_partial_hex
				}),
				submitSpend
			}
		});
		expect(out.gate ?? out.message).toMatch(/ARK_SETTLE_CEREMONY_INVALID/);
		expect(submitSpend).not.toHaveBeenCalled();
	});

	it('refuses to deliver a WASM partial that does not verify', async () => {
		state.balance = '1000000';
		state.walletCreate.mockResolvedValue({});
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const deliverProviderPartial = vi.fn(async () => undefined);
		const out = await runSwapRole('provider', order, SELLER_FP, {
			...fast,
			providerPartialSigner: async () => vector.referee_partial_hex,
			settleTransport: { deliverProviderPartial }
		});
		expect(out.gate).toMatch(/^ARK_SETTLE_CEREMONY_INVALID/);
		expect(deliverProviderPartial).not.toHaveBeenCalled();
	});
});

describe('bearer-seller side', () => {
	it('default per-direction cap (1 webcash) stops an e100 bearer leg before pre-check', async () => {
		state.msgs = [offer()];
		const { maxBearerWebcash: _cap, ...noCap } = fast as typeof fast & { maxBearerWebcash?: string };
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, noCap as never);
		expect(out.message ?? out.gate).toMatch(/exceeds the per-direction cap 1/);
		expect(state.submitPrecheck).not.toHaveBeenCalled();
	});
	it('stops before the provider may fund when its bearer H was never issued (spent:null)', async () => {
		state.msgs = [offer()];
		state.legIssued.mockRejectedValue(new Error('BEARER_LEG_NOT_ISSUED: the bearer webcash H is unknown to the rail'));
		const log: SwapProgress[] = [];
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, { ...fast, onProgress: (p) => log.push(p) });
		expect(out.gate).toMatch(/^BEARER_LEG_NOT_ISSUED/);
		expect(phases(log)).not.toContain('awaiting-material');
		expect(state.submitPrecheck).not.toHaveBeenCalled();
	});

	it('stops at REFEREE_CEREMONY_UNAVAILABLE before waiting for funding on the old referee', async () => {
		state.refereePubkey = { ed25519_pubkey_hex: CFG.referee_vk_hex, musig2_pubshare_hex: vector.referee_pubkey_hex };
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const log: SwapProgress[] = [];
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, { ...fast, onProgress: (p) => log.push(p) });
		expect(out.gate).toMatch(/^ARK_REFEREE_CEREMONY_UNAVAILABLE/);
		expect(phases(log)).not.toContain('awaiting-material');
	});

	it('without a ReleaseSettle transport stops at RELEASE_PENDING after binding', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, fast);
		expect(out.gate).toMatch(/^ARK_SETTLE_RELEASE_PENDING/);
	});

	it('aggregates the exact Rust-vector signature from ReleaseSettle + provider partial', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, {
			...fast,
			settleTransport: {
				awaitReleaseSettle: async () => ({
					release: { refereePartialHex: vector.referee_partial_hex, providerEncPartialB64: 'AAEC', aspVtxoRef: LOCKED },
					providerPartialHex: vector.provider_partial_hex
				})
			}
		});
		expect(out.phase).toBe('settle-aggregated');
		expect(out.settleSignatureHex).toBe(vector.signature_hex);
	});

	it('two-proof initiate: verifies the provider partial, initiates, advances after H is spent, settles and submits', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const sealed = new Uint8Array([9, 9, 9]);
		const initiate = vi.fn(async () => ({ swapId: SWAP_ID, phase: 'insert-pushed' }));
		const spent = [false, true];
		const advance = vi.fn(async () => ({ phase: 'settled', terminal: true }));
		const submitSpend = vi.fn(async () => 'e0'.repeat(32));
		const sealBearerSecret = vi.fn(async () => new Uint8Array([7]));
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, {
			...fast,
			settleWaitMs: 500,
			settleTransport: {
				awaitProviderPartial: async () => ({ sealed, partialHex: vector.provider_partial_hex }),
				sealBearerSecret,
				initiate,
				bearerSpent: async () => spent.shift() ?? true,
				advance,
				awaitReleaseSettle: async () => ({
					release: {
						refereePartialHex: vector.referee_partial_hex,
						providerEncPartialB64: 'AAEC',
						aspVtxoRef: LOCKED
					},
					providerPartialHex: vector.provider_partial_hex
				}),
				submitSpend
			}
		});
		expect(out.phase).toBe('settled');
		expect(out.arkTxid).toBe('e0'.repeat(32));
		expect(initiate).toHaveBeenCalledWith({ slot: 0, facts: { facts: 'two-proof' } });
		expect(advance).toHaveBeenCalledTimes(1);
		expect(sealBearerSecret).toHaveBeenCalledWith(
			expect.objectContaining({
				amount: '100',
				bearerAsset: { family: 'Webcash' },
				swapId: SWAP_ID,
				providerVk: hex('77'.repeat(32))
			})
		);
		const init = state.initFacts as {
			provider: { payload: Uint8Array };
			expectedProviderFpHex: string;
		};
		expect(init.provider.payload.length).toBe(128);
		expect(Array.from(init.provider.payload.slice(0, 7))).toEqual([0, 0, 0, 3, 9, 9, 9]);
		expect(init.expectedProviderFpHex).toBe(PROVIDER_FP);
		expect(submitSpend).toHaveBeenCalledWith(
			expect.objectContaining({
				spend: expect.objectContaining({ kind: 'settle' }),
				aggregateSigsHex: vector.signature_hex
			})
		);
	});

	it('two-proof initiate: refuses a provider partial that does not verify (no initiate)', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const initiate = vi.fn(async () => ({ swapId: SWAP_ID, phase: 'insert-pushed' }));
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, {
			...fast,
			settleTransport: {
				awaitProviderPartial: async () => ({
					sealed: new Uint8Array([1]),
					partialHex: vector.referee_partial_hex
				}),
				sealBearerSecret: async () => new Uint8Array([7]),
				initiate
			}
		});
		expect(out.gate ?? out.message).toMatch(/ARK_SETTLE_CEREMONY_INVALID/);
		expect(initiate).not.toHaveBeenCalled();
	});

	it('two-proof initiate: an aborted referee swap is an error, never a settle', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const awaitReleaseSettle = vi.fn();
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, {
			...fast,
			settleWaitMs: 20,
			settleTransport: {
				awaitProviderPartial: async () => ({
					sealed: new Uint8Array([1]),
					partialHex: vector.provider_partial_hex
				}),
				sealBearerSecret: async () => new Uint8Array([7]),
				initiate: async () => ({ swapId: SWAP_ID, phase: 'insert-pushed' }),
				bearerSpent: async () => false,
				advance: async () => ({ phase: 'refunded', terminal: true }),
				awaitReleaseSettle
			}
		});
		expect(out.phase).toBe('error');
		expect(out.message).toMatch(/did not settle \(phase=refunded\)/);
		expect(awaitReleaseSettle).not.toHaveBeenCalled();
	});

	it('rejects a tampered referee partial', async () => {
		state.msgs = [offer()];
		state.material = fundedMaterial();
		const out = await runSwapRole('bearer-seller', order, PROVIDER_FP, {
			...fast,
			settleTransport: {
				awaitReleaseSettle: async () => ({
					release: { refereePartialHex: vector.provider_partial_hex, providerEncPartialB64: 'AAEC', aspVtxoRef: LOCKED },
					providerPartialHex: vector.provider_partial_hex
				})
			}
		});
		expect(out.gate).toMatch(/^ARK_SETTLE_CEREMONY_INVALID/);
		expect(out.settleSignatureHex).toBeUndefined();
	});
});
