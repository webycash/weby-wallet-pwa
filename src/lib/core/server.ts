// Server client — all network I/O contained here.
// Wallet is proxied under weby.cash, so use relative /api/ paths for testnet.
// Production calls webcash.org directly.

import type {
	NetworkMode, HealthResponse, ReplaceRequest, ReplaceResponse,
	TargetResponse, MiningReportRequest, MiningReportResponse
} from './types';

const apiUrl = (network: NetworkMode, path: string): string => {
	if (network === 'testnet') {
		return `/api/webcash/testnet/api/v1/${path}`;
	}
	return `https://webcash.org/api/v1/${path}`;
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

const get = async <T>(url: string): Promise<T> => {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
	return res.json();
};

export const healthCheck = (network: NetworkMode, webcashes: string[]): Promise<HealthResponse> =>
	post(apiUrl(network, 'health_check'), { webcashes });

export const replace = (network: NetworkMode, request: ReplaceRequest): Promise<ReplaceResponse> =>
	post(apiUrl(network, 'replace'), request);

export const getTarget = (network: NetworkMode): Promise<TargetResponse> =>
	get(apiUrl(network, 'target'));

export const submitMiningReport = (network: NetworkMode, report: MiningReportRequest): Promise<MiningReportResponse> =>
	post(apiUrl(network, 'mining_report'), report);
