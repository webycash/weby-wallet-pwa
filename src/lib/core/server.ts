// Server client — all network I/O.
// URLs come from webylib via WASM. POST endpoints have CORS, GET /target proxied.

import type {
	NetworkMode, HealthResponse, ReplaceRequest, ReplaceResponse,
	TargetResponse, MiningReportRequest, MiningReportResponse
} from './types';
import { getWasm } from './wasm';

const endpoint = async (network: NetworkMode, path: string): Promise<string> => {
	const wasm = await getWasm();
	return wasm.api_url(network, path);
};

const post = async <T>(url: string, body: unknown): Promise<T> => {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(`${res.status}: ${text}`);
	}
	return res.json();
};

// POST endpoints — CORS enabled on webcash.org, call directly.

export const healthCheck = async (network: NetworkMode, webcashes: string[]): Promise<HealthResponse> =>
	post(await endpoint(network, 'health_check'), webcashes);

export const replace = async (network: NetworkMode, request: ReplaceRequest): Promise<ReplaceResponse> =>
	post(await endpoint(network, 'replace'), request);

export const submitMiningReport = async (network: NetworkMode, report: MiningReportRequest): Promise<MiningReportResponse> =>
	post(await endpoint(network, 'mining_report'), report);

// GET /target — no CORS on webcash.org, must proxy through weby.cash.
export const getTarget = async (network: NetworkMode): Promise<TargetResponse> => {
	const url = network === 'testnet'
		? '/api/webcash/testnet/api/v1/target'
		: '/api/v1/target';
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
	return res.json();
};
