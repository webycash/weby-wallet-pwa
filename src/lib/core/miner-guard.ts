// Mining is a DEV-test-webcash tool only. Never mine against mainnet
// webcash (webcash.org) or on a mainnet-money deployment (staging/production).
import { isMainnetTier } from '$lib/extro/release-config';

export const miningRefusal = (cfg: { deployment?: string; webcash_server_url?: string } | null | undefined): string | null => {
	if (!cfg) return 'Mining disabled: runtime config not loaded';
	if (cfg.deployment !== 'development' || isMainnetTier(cfg.deployment as never))
		return `Mining disabled on ${cfg.deployment ?? 'unknown'} deployment (mainnet money)`;
	let host = '';
	try { host = new URL(cfg.webcash_server_url ?? '').hostname.toLowerCase(); } catch { return 'Mining disabled: invalid webcash server URL'; }
	if (host === 'webcash.org' || host.endsWith('.webcash.org')) return 'Mining disabled: mainnet webcash server';
	return null;
};
