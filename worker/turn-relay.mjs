// Cloudflare Realtime TURN: mint short-lived relay credentials per boot.
//
// The wallet never sees a long-term TURN secret. Each GET of the runtime config
// asks the Cloudflare Realtime API for an ICE credential bound to the operator's
// TURN key (TURN_KEY_ID / TURN_KEY_API_TOKEN are `wrangler secret`s) and expiring
// after PUBLIC_TURN_TTL_SECONDS. Any failure throws: a mainnet tier must refuse to
// boot rather than fall back to a public relay (extro-node validate_mainnet_trust_set
// rejects an empty TURN list).
//
// https://developers.cloudflare.com/realtime/turn/generate-credentials/

const CLOUDFLARE_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const MIN_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 172800;

/** Port 53 is commonly blocked/intercepted by browsers and middleboxes; Cloudflare
 *  recommends filtering it out for browser clients. */
function usableTurnUrl(url) {
  return /^turns?:/.test(url) && !/:53(\?|$)/.test(url);
}

export function turnTtlSeconds(env) {
  const ttl = Number(env.PUBLIC_TURN_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new Error(
      `PUBLIC_TURN_TTL_SECONDS must be an integer in [${MIN_TTL_SECONDS}, ${MAX_TTL_SECONDS}]`,
    );
  }
  return ttl;
}

/** Returns extro-node `turn_servers` entries ({url, username, credential}). */
export async function mintCloudflareTurnServers(env) {
  const keyId = env.TURN_KEY_ID;
  const token = env.TURN_KEY_API_TOKEN;
  if (!keyId || !token) throw new Error('TURN_KEY_ID / TURN_KEY_API_TOKEN secrets are not set');
  const response = await fetch(
    `${CLOUDFLARE_TURN_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: turnTtlSeconds(env) }),
    },
  );
  if (!response.ok) throw new Error(`Cloudflare TURN credential mint failed (HTTP ${response.status})`);
  const body = await response.json();
  const servers = [];
  for (const entry of body?.iceServers ?? []) {
    if (typeof entry?.username !== 'string' || typeof entry?.credential !== 'string') continue;
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    for (const url of urls) {
      if (typeof url === 'string' && usableTurnUrl(url)) {
        servers.push({ url, username: entry.username, credential: entry.credential });
      }
    }
  }
  if (servers.length === 0) throw new Error('Cloudflare TURN returned no usable turn:/turns: URL');
  return servers;
}
