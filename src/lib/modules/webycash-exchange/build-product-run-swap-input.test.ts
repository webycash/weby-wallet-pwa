import { describe, expect, it } from 'vitest';
import { pairReleaseAvailability } from './pair-policy';
import { serializePrepareTermsDraft, parsePrepareTermsDraft } from './prepare-terms-draft';

describe('product Accept wiring helpers', () => {
	it('keeps BitcoinArk/Webcash available and labels RGB/Voucher pairs with the Worker rail', () => {
		expect(pairReleaseAvailability('BitcoinArk', 'Webcash').available).toBe(true);
		// Voucher/RGB were re-enabled (4c3f299) on the issuer-hosted webycash-server rail.
		for (const [a, b] of [
			['Rgb20', 'Webcash'],
			['Voucher', 'BitcoinArk']
		] as const) {
			const v = pairReleaseAvailability(a, b);
			if (v.available) expect(v.message).toContain('webycash-server Worker');
			else expect(v.exclusion).toBe('pair-policy-blocked');
		}
	});

	it('prepare-terms draft round-trips critical fields', () => {
		const terms = {
			order_id: new Uint8Array(32).fill(1),
			signed_order_commitment_sha256: new Uint8Array(32).fill(2),
			fill_amount_raw: 1n,
			parties: {
				provider_fp: 'aa'.repeat(20),
				provider_pgp_pubkey_hex: 'bb'.repeat(32),
				bearer_seller_fp: 'cc'.repeat(20),
				bearer_seller_pgp_pubkey_hex: 'dd'.repeat(32),
				provider_musig2_pubkey: '02' + 'ee'.repeat(32),
				provider_cancel_pubkey_hex: 'ff'.repeat(32),
				bearer_seller_cancel_pubkey_hex: '11'.repeat(32)
			},
			provider_nonces: {
				settle_nonce_pub: '03' + '22'.repeat(32),
				refund_nonce_pub: '02' + '33'.repeat(32)
			},
			ark_network: 'regtest' as const,
			ark_operator_signer_pk: new Uint8Array(32).fill(4),
			ark_operator_info_digest: new Uint8Array(32).fill(5),
			ark_unilateral_exit_delay: 512n,
			ark_amount_sats: 25_000n,
			provider_ark_destination: 'ark:provider',
			bearer_seller_ark_destination: 'ark:seller',
			idempotency_key: new Uint8Array(16).fill(6),
			nonce: new Uint8Array(32).fill(7),
			expires_at_unix: 1_700_000_000
		};
		const wire = serializePrepareTermsDraft(terms as never);
		const back = parsePrepareTermsDraft(wire);
		expect(back.fill_amount_raw).toBe(1n);
		expect(back.ark_amount_sats).toBe(25_000n);
		expect(back.parties.provider_fp).toBe(terms.parties.provider_fp);
	});
});
