// Algebraic types matching webylib Rust structs exactly.

export type NetworkMode = 'production' | 'testnet';

export type ChainCode = 0 | 1 | 2 | 3;
export const CHAIN = { RECEIVE: 0, PAY: 1, CHANGE: 2, MINING: 3 } as const;

export type Result<T> =
	| { ok: true; value: T }
	| { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T>(error: string): Result<T> => ({ ok: false, error });

export interface SecretWebcash {
	readonly secret: string;      // 64 hex chars
	readonly amountWats: number;  // i64 in wats
}

export interface PublicWebcash {
	readonly hash: string;        // 64 hex chars (SHA-256 of secret string)
	readonly amountWats: number;
}

export interface WalletStats {
	readonly totalWebcash: number;
	readonly unspentWebcash: number;
	readonly spentWebcash: number;
	readonly totalBalance: number; // in wats
}

export interface CheckResult {
	readonly validCount: number;
	readonly spentCount: number;
	readonly unknownCount: number;
}

export interface WalletSnapshot {
	readonly master_secret: string;
	readonly unspent_outputs: readonly UnspentOutputSnapshot[];
	readonly spent_hashes: readonly SpentHashSnapshot[];
	readonly depths: Record<string, number>;
}

export interface UnspentOutputSnapshot {
	readonly secret: string;
	readonly amount: number;
	readonly created_at: string;
}

export interface SpentHashSnapshot {
	readonly hash: string;
	readonly spent_at: string;
}

// Server protocol types

export interface HealthResponse {
	readonly results: readonly { readonly hash: string; readonly spent: boolean }[];
}

export interface ReplaceRequest {
	readonly webcashes: readonly string[];
	readonly new_webcashes: readonly string[];
	readonly legalese: { readonly terms: boolean };
}

export interface ReplaceResponse {
	readonly amount?: string;
}

export interface TargetResponse {
	readonly difficulty: number;
	readonly mining_amount: number;
	readonly mining_subsidy_amount?: number;
}

export interface MiningReportRequest {
	readonly preimage: string;
	readonly legalese: { readonly terms: boolean };
}

export interface MiningReportResponse {
	readonly amount?: string;
}

// Encryption types (matches webylib EncryptedData)

export interface EncryptedData {
	readonly ciphertext: number[];
	readonly nonce: number[];
	readonly salt: number[];
	readonly algorithm: string;
	readonly kdf_params: {
		readonly info: string;
		readonly iterations: number;
		readonly memory_cost: number;
		readonly parallelism: number;
	};
	readonly metadata: {
		readonly encrypted_at: string;
		readonly platform: string;
		readonly version: string;
		readonly passkey_type: string | null;
	};
}

// Internal storage types

export interface StoredOutput {
	readonly id?: number;
	readonly secretHash: ArrayBuffer;
	readonly secret: string;
	readonly amount: number;
	readonly createdAt: string;
	readonly spent: 0 | 1;
}

export interface StoredSpentHash {
	readonly id?: number;
	readonly hash: ArrayBuffer;
	readonly spentAt: string;
}
