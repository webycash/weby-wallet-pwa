// Wallet-funded payments for connected apps (ADR-0008 T3 spend).
//
// A connected app (e.g. extro.life paying its posting toll) sends
// `Rail PayWebcash { amount, inputs: [], server_url }`. The node answers
// ConfirmationRequired; after the user confirms in this wallet, this hook
// supplies the inputs from the wallet's own webcash balance and runs the op
// as the wallet's own command. Order of effects (nothing stranded):
//   1. payWebcash(exact)  → a fresh exact-amount secret leaves the wallet
//   2. PayWebcash         → server replace(that secret → payment secret)
//   3. on failure         → the secret is re-inserted into the wallet
// Input secrets only ever go to the wallet's own configured webcash server.
import { newRequestId, type ExtroResponse, type Op } from '@extro/node';
import { webcashToWats } from '$lib/modules/webycash-exchange/bearer-reserve';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type WalletFundDeps = {
	/** The wallet's own webcash server (runtime config `webcash_server_url`). */
	serverUrl: () => string;
	pay: (wats: number) => Promise<Result<string>>;
	insert: (secret: string) => Promise<Result<void>>;
};

/** Same webcash server: origin and path, trailing slash ignored. */
export const sameServer = (a: string, b: string) => {
	try {
		const x = new URL(a);
		const y = new URL(b);
		return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
	} catch {
		return false;
	}
};

const fail = (code: string, message: string): ExtroResponse => ({
	kind: 'Err',
	request_id: newRequestId(),
	code,
	message
});

/** Fund a confirmed `PayWebcash` without inputs; `null` for any other op. */
export async function fundFromWallet(
	op: Op,
	run: (op: Op) => Promise<ExtroResponse>,
	deps: WalletFundDeps
): Promise<ExtroResponse | null> {
	if (op.kind !== 'Rail' || op.cmd.op !== 'PayWebcash' || op.cmd.inputs.length > 0) return null;
	const cmd = op.cmd;
	if (!sameServer(cmd.server_url, deps.serverUrl())) {
		return fail('PolicyRejected', 'webcash pay: the wallet pays only on its own webcash server');
	}
	let wats: bigint;
	try {
		wats = webcashToWats(cmd.amount);
	} catch (e) {
		return fail('MalformedCommand', `webcash pay: ${e instanceof Error ? e.message : String(e)}`);
	}
	const paid = await deps.pay(Number(wats));
	if (!paid.ok) return fail('WalletError', `webcash pay: the wallet cannot fund ${cmd.amount} webcash (${paid.error})`);
	const out = await run({ kind: 'Rail', cmd: { ...cmd, inputs: [paid.value] } });
	if (out.kind !== 'Ok' || out.body.kind !== 'WebcashPaid' || !out.body.unspent) {
		const back = await deps.insert(paid.value);
		const why = out.kind === 'Err' ? out.message : 'the payment is not unspent on the server';
		return fail(
			'WalletError',
			`webcash pay failed (${why}); ${back.ok ? 'funds re-inserted into the wallet' : `RE-INSERT FAILED: ${back.error}`}`
		);
	}
	if (out.body.change) {
		const c = await deps.insert(out.body.change);
		if (!c.ok) return fail('WalletError', `webcash pay: change re-insert failed (${c.error})`);
	}
	return out;
}
