// SvelteKit binding for @extro/node's release config: the one place this app
// reads `$app/paths` + `$env/dynamic/public` for it. Everything else is the
// package's (parse, strict validation, the loaded-config singleton).

export {
	disableArkForSession,
	getRuntimeConfig,
	isMainnetTier,
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
	const [{ base }, { env }] = await Promise.all([
		import('$app/paths'),
		import('$env/dynamic/public')
	]);
	return loadFrom({ base, publicEnv: env, fetcher });
}
