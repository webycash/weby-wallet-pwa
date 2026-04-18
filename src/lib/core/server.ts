// Server client — all network I/O.
// URLs come from webylib via WASM — single source of truth.

import type {
	NetworkMode, HealthResponse, ReplaceRequest, ReplaceResponse,
	TargetResponse, MiningReportRequest, MiningReportResponse
} from './types';
import { getWasm } from './wasm';

const url = async (network: NetworkMode, endpoint: string): Promise<string> => {
	const wasm = await getWasm();
	return wasm.api_url(network, endpoint);
};

const post = async <T>(u: string, body: unknown): Promise<T> => {
	const res = await fetch(u, {
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

const get = async <T>(u: string): Promise<T> => {
	const res = await fetch(u);
	if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
	return res.json();
};

export const healthCheck = async (network: NetworkMode, webcashes: string[]): Promise<HealthResponse> =>
	post(await url(network, 'health_check'), webcashes);

export const replace = async (network: NetworkMode, request: ReplaceRequest): Promise<ReplaceResponse> =>
	post(await url(network, 'replace'), request);

export const getTarget = async (network: NetworkMode): Promise<TargetResponse> =>
	get(await url(network, 'target'));

export const submitMiningReport = async (network: NetworkMode, report: MiningReportRequest): Promise<MiningReportResponse> =>
	post(await url(network, 'mining_report'), report);
