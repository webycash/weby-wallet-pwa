// SvelteKit binding for @extro/node's release config: the one place this app
// reads `$app/paths` + `$env/dynamic/public` for it. Everything else is the
// package's (parse, strict validation, the loaded-config singleton).

export {
	disableArkForSession,
	getRuntimeConfig,
	isMainnetTier,
	refereeAvailable,
	parseRuntimeConfig,
	resetRuntimeConfigForTests,
	RuntimeConfigError,
	setRuntimeConfigForTests,
	type ArkNetwork,
	type DeploymentTier,
	type ExtroRuntimeConfig,
	type RuntimeTurnServer
} from '@extro/node';
import { loadRuntimeConfig as loadFrom, type ExtroRuntimeConfig } from '@extro/node';

/** Load `${base}/runtime-config.json` (see `loadRuntimeConfig` in @extro/node). */
export async function loadRuntimeConfig(fetcher: typeof fetch = fetch): Promise<ExtroRuntimeConfig> {
	const [{ base }, { env }, { version }] = await Promise.all([
		import('$app/paths'),
		import('$env/dynamic/public'),
		import('$app/environment')
	]);
	return loadFrom({ base, publicEnv: env, fetcher: freshConfigFetcher(fetcher, version) });
}

/**
 * The config must come from the network on every boot. `no-store` covers the
 * HTTP cache; the build-versioned URL covers service workers shipped before
 * this one, which answered every same-origin GET (the config included) from
 * their cache. The Worker matches the path only.
 */
export function freshConfigFetcher(fetcher: typeof fetch, version: string): typeof fetch {
	return (input, init) => {
		const url = String(input);
		const sep = url.includes('?') ? '&' : '?';
		return fetcher(`${url}${sep}build=${encodeURIComponent(version)}`, { ...init, cache: 'no-store' });
	};
}
