export type DeploymentTier = 'development' | 'production';
export type ArkNetwork = 'regtest' | 'signet' | 'bitcoin';

export interface RuntimeTurnServer {
	url: string;
	username: string;
	credential: string;
}

/** Exact JS shape accepted by extro-node's `extro_encode_boot_config`. */
export interface ExtroRuntimeConfig {
	schema_version: 1;
	deployment: DeploymentTier;
	db_name: string;
	adapter_mode: 'bundled';
	keyserver_url: string;
	keyserver_domain: string;
	keyserver_fingerprint_hex: string;
	keyserver_vk_hex: string;
	referee_url: string;
	referee_vk_hex: string;
	webcash_server_url: string;
	voucher_server_url: string;
	rgb_server_url: string;
	rgb_collectible_server_url: string;
	ark_enabled: boolean;
	ark_network: ArkNetwork;
	ark_asp_url: string;
	ark_owner_pk_hex: string;
	zkp_profile: string;
	zkp_bearer_vk_sha256: string;
	zkp_conditional_vk_sha256: string;
	ice_servers: string[];
	turn_servers: RuntimeTurnServer[];
}

const FIELDS = [
	'schema_version',
	'deployment',
	'db_name',
	'adapter_mode',
	'keyserver_url',
	'keyserver_domain',
	'keyserver_fingerprint_hex',
	'keyserver_vk_hex',
	'referee_url',
	'referee_vk_hex',
	'webcash_server_url',
	'voucher_server_url',
	'rgb_server_url',
	'rgb_collectible_server_url',
	'ark_enabled',
	'ark_network',
	'ark_asp_url',
	'ark_owner_pk_hex',
	'zkp_profile',
	'zkp_bearer_vk_sha256',
	'zkp_conditional_vk_sha256',
	'ice_servers',
	'turn_servers'
] as const;

const DEV_VK_HASHES = new Set([
	'ecd299b3326e682106a31a39decf1fb43c0d5b960eb40baa2975691f406f77c1',
	'8efdd75f738658f3da0308fac3cbf6912c1324e815d863548c7e82ba39d07f1d'
]);

let active: ExtroRuntimeConfig | null = null;

export class RuntimeConfigError extends Error {
	constructor(message: string) {
		super(`Extro runtime configuration: ${message}`);
		this.name = 'RuntimeConfigError';
	}
}

const object = (value: unknown, name: string): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new RuntimeConfigError(`${name} must be an object`);
	}
	return value as Record<string, unknown>;
};

const string = (source: Record<string, unknown>, name: string, allowEmpty = false): string => {
	const value = source[name];
	if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
		throw new RuntimeConfigError(`missing or invalid field \`${name}\``);
	}
	if (/replace_me|placeholder|example\.invalid/i.test(value)) {
		throw new RuntimeConfigError(`field \`${name}\` contains a placeholder`);
	}
	return value;
};

const hex = (source: Record<string, unknown>, name: string, length: number): string => {
	const value = string(source, name);
	if (value.length !== length || !/^[0-9a-f]+$/i.test(value)) {
		throw new RuntimeConfigError(`field \`${name}\` must be ${length} hexadecimal characters`);
	}
	if (/^0+$/.test(value)) throw new RuntimeConfigError(`field \`${name}\` must not be all zero`);
	return value.toLowerCase();
};

const url = (
	source: Record<string, unknown>,
	name: string,
	deployment: DeploymentTier,
	allowEmpty = false
): string => {
	const value = string(source, name, allowEmpty);
	if (allowEmpty && value === '') return value;
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new RuntimeConfigError(`field \`${name}\` is not a valid URL`);
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new RuntimeConfigError(`field \`${name}\` must not contain credentials, query, or fragment`);
	}
	if (deployment === 'production') {
		if (parsed.protocol !== 'https:') {
			throw new RuntimeConfigError(`field \`${name}\` must use https in production`);
		}
		if (/^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(parsed.hostname) || parsed.hostname.endsWith('.local')) {
			throw new RuntimeConfigError(`field \`${name}\` points to a local host in production`);
		}
	} else if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new RuntimeConfigError(`field \`${name}\` must use http or https`);
	}
	return value.replace(/\/$/, '');
};

export function parseRuntimeConfig(input: unknown): ExtroRuntimeConfig {
	const source = object(input, 'root');
	for (const key of Object.keys(source)) {
		if (!(FIELDS as readonly string[]).includes(key)) {
			throw new RuntimeConfigError(`unknown field \`${key}\``);
		}
	}
	for (const field of FIELDS) {
		if (!(field in source)) throw new RuntimeConfigError(`missing field \`${field}\``);
	}
	if (source.schema_version !== 1) {
		throw new RuntimeConfigError(`unsupported schema_version \`${String(source.schema_version)}\``);
	}
	if (source.deployment !== 'development' && source.deployment !== 'production') {
		throw new RuntimeConfigError('deployment must be `development` or `production`');
	}
	const deployment = source.deployment;
	if (source.adapter_mode !== 'bundled') {
		throw new RuntimeConfigError('adapter_mode must be `bundled`; mock/cross-domain are prohibited');
	}
	if (typeof source.ark_enabled !== 'boolean') {
		throw new RuntimeConfigError('field `ark_enabled` must be a boolean');
	}
	if (!['regtest', 'signet', 'bitcoin'].includes(String(source.ark_network))) {
		throw new RuntimeConfigError('ark_network must be `regtest`, `signet`, or `bitcoin`');
	}

	const keyserverUrl = url(source, 'keyserver_url', deployment);
	const keyserverDomain = string(source, 'keyserver_domain');
	if (new URL(keyserverUrl).hostname !== keyserverDomain) {
		throw new RuntimeConfigError('keyserver_domain does not match keyserver_url host');
	}

	if (!Array.isArray(source.ice_servers) || source.ice_servers.length === 0) {
		throw new RuntimeConfigError('ice_servers must be a non-empty array');
	}
	const iceServers = source.ice_servers.map((entry, index) => {
		if (typeof entry !== 'string' || !/^stuns?:/.test(entry)) {
			throw new RuntimeConfigError(`ice_servers[${index}] must use stun: or stuns:`);
		}
		return entry;
	});
	if (!Array.isArray(source.turn_servers)) {
		throw new RuntimeConfigError('turn_servers must be an array');
	}
	const turnServers = source.turn_servers.map((entry, index): RuntimeTurnServer => {
		const turn = object(entry, `turn_servers[${index}]`);
		for (const key of Object.keys(turn)) {
			if (!['url', 'username', 'credential'].includes(key)) {
				throw new RuntimeConfigError(`unknown turn_servers[${index}] field \`${key}\``);
			}
		}
		if (!['url', 'username', 'credential'].every((key) => key in turn)) {
			throw new RuntimeConfigError(`turn_servers[${index}] is incomplete`);
		}
		const turnUrl = string(turn, 'url');
		if (!/^turns?:/.test(turnUrl)) {
			throw new RuntimeConfigError(`turn_servers[${index}].url must use turn: or turns:`);
		}
		return {
			url: turnUrl,
			username: string(turn, 'username'),
			credential: string(turn, 'credential')
		};
	});

	const arkEnabled = source.ark_enabled;
	const arkNetwork = source.ark_network as ArkNetwork;
	const arkAspUrl = url(source, 'ark_asp_url', deployment, !arkEnabled);
	const arkOwnerPkHex = arkEnabled
		? hex(source, 'ark_owner_pk_hex', 64)
		: string(source, 'ark_owner_pk_hex', true);
	const zkpProfile = string(source, 'zkp_profile');
	const zkpBearer = hex(source, 'zkp_bearer_vk_sha256', 64);
	const zkpConditional = hex(source, 'zkp_conditional_vk_sha256', 64);

	if (deployment === 'production') {
		if (!arkEnabled) throw new RuntimeConfigError('ark_enabled must be true in production');
		if (arkNetwork !== 'bitcoin') {
			throw new RuntimeConfigError('ark_network must be `bitcoin` in production');
		}
		if (zkpProfile.toLowerCase() === 'development-only') {
			throw new RuntimeConfigError('development-only ZKP profile is prohibited in production');
		}
		if (DEV_VK_HASHES.has(zkpBearer) || DEV_VK_HASHES.has(zkpConditional)) {
			throw new RuntimeConfigError('known forgeable development-ceremony VK is prohibited in production');
		}
		if (turnServers.length === 0) {
			throw new RuntimeConfigError('managed TURN credentials are required in production');
		}
		if (
			turnServers.some(
				(turn) =>
					turn.url.includes('openrelay.metered.ca') ||
					turn.username === 'openrelayproject' ||
					turn.credential === 'openrelayproject'
			)
		) {
			throw new RuntimeConfigError('public Open Relay credentials are prohibited in production');
		}
	} else if (arkEnabled && arkNetwork === 'bitcoin') {
		throw new RuntimeConfigError('development cannot enable Ark on bitcoin mainnet');
	}

	return {
		schema_version: 1,
		deployment,
		db_name: string(source, 'db_name'),
		adapter_mode: 'bundled',
		keyserver_url: keyserverUrl,
		keyserver_domain: keyserverDomain,
		keyserver_fingerprint_hex: hex(source, 'keyserver_fingerprint_hex', 40),
		keyserver_vk_hex: hex(source, 'keyserver_vk_hex', 64),
		referee_url: url(source, 'referee_url', deployment),
		referee_vk_hex: hex(source, 'referee_vk_hex', 64),
		webcash_server_url: url(source, 'webcash_server_url', deployment),
		voucher_server_url: url(source, 'voucher_server_url', deployment),
		rgb_server_url: url(source, 'rgb_server_url', deployment),
		rgb_collectible_server_url: url(source, 'rgb_collectible_server_url', deployment),
		ark_enabled: arkEnabled,
		ark_network: arkNetwork,
		ark_asp_url: arkAspUrl,
		ark_owner_pk_hex: arkOwnerPkHex,
		zkp_profile: zkpProfile,
		zkp_bearer_vk_sha256: zkpBearer,
		zkp_conditional_vk_sha256: zkpConditional,
		ice_servers: iceServers,
		turn_servers: turnServers
	};
}

/**
 * Load the same-origin, Worker-generated release config. Local Vite sessions
 * may use the explicit PUBLIC_* mapping below; deployed builds never receive a
 * silent default.
 */
export async function loadRuntimeConfig(fetcher: typeof fetch = fetch): Promise<ExtroRuntimeConfig> {
	if (active) return active;
	const [{ base }, { env }] = await Promise.all([import('$app/paths'), import('$env/dynamic/public')]);
	const endpoint = `${base}/runtime-config.json` || '/runtime-config.json';
	const response = await fetcher(endpoint, { cache: 'no-store', credentials: 'same-origin' });
	if (response.ok) {
		active = parseRuntimeConfig(await response.json());
		return active;
	}
	if (env.PUBLIC_DEPLOYMENT !== 'development') {
		throw new RuntimeConfigError(`${endpoint} returned HTTP ${response.status}`);
	}
	active = parseRuntimeConfig(configFromPublicEnv(env as Record<string, string | undefined>));
	return active;
}

export function getRuntimeConfig(): ExtroRuntimeConfig {
	if (!active) throw new RuntimeConfigError('configuration has not been loaded');
	return active;
}

function parseJsonArray(value: string | undefined, name: string): unknown[] {
	if (!value) throw new RuntimeConfigError(`missing local field \`${name}\``);
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) throw new Error('not an array');
		return parsed;
	} catch (error) {
		throw new RuntimeConfigError(`local field \`${name}\` is invalid JSON: ${String(error)}`);
	}
}

function configFromPublicEnv(source: Record<string, string | undefined>): unknown {
	return {
		schema_version: Number(source.PUBLIC_BOOT_SCHEMA_VERSION),
		deployment: source.PUBLIC_DEPLOYMENT,
		db_name: source.PUBLIC_EXTRO_DB_NAME,
		adapter_mode: source.PUBLIC_EXTRO_ADAPTER,
		keyserver_url: source.PUBLIC_KEYSERVER_URL,
		keyserver_domain: source.PUBLIC_KEYSERVER_DOMAIN,
		keyserver_fingerprint_hex: source.PUBLIC_KEYSERVER_FINGERPRINT,
		keyserver_vk_hex: source.PUBLIC_KEYSERVER_VK,
		referee_url: source.PUBLIC_REFEREE_URL,
		referee_vk_hex: source.PUBLIC_REFEREE_VK,
		webcash_server_url: source.PUBLIC_WEBCASH_SERVER_URL,
		voucher_server_url: source.PUBLIC_VOUCHER_SERVER_URL,
		rgb_server_url: source.PUBLIC_RGB_SERVER_URL,
		rgb_collectible_server_url: source.PUBLIC_RGB_COLLECTIBLE_SERVER_URL,
		ark_enabled: source.PUBLIC_ARK_ENABLED === 'true',
		ark_network: source.PUBLIC_ARK_NETWORK,
		ark_asp_url: source.PUBLIC_ARK_ASP_URL ?? '',
		ark_owner_pk_hex: source.PUBLIC_ARK_OWNER_PK_HEX ?? '',
		zkp_profile: source.PUBLIC_ZKP_PROFILE,
		zkp_bearer_vk_sha256: source.PUBLIC_ZKP_BEARER_VK_SHA256,
		zkp_conditional_vk_sha256: source.PUBLIC_ZKP_CONDITIONAL_VK_SHA256,
		ice_servers: parseJsonArray(source.PUBLIC_ICE_SERVERS_JSON, 'PUBLIC_ICE_SERVERS_JSON'),
		turn_servers: parseJsonArray(source.PUBLIC_TURN_SERVERS_JSON, 'PUBLIC_TURN_SERVERS_JSON')
	};
}

/** Test-only reset; application code must never replace a loaded release config. */
export function resetRuntimeConfigForTests(): void {
	active = null;
}
