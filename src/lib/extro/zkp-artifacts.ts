// Proving-key artifacts per ZKP profile.
//
// `zkp-artifacts.json` (repo root) pins, for every profile the wallet can run,
// the directory the proving keys are served from and their SHA-256. The keys
// are installed by `npm run install:zkp` and re-hashed in the browser before
// they reach the prover, so a stale, swapped or development key can never be
// used under a profile it was not published for.

import manifest from '../../../zkp-artifacts.json';

export const BEARER_PK_FILE = 'pk_bearer_payload.bin';
export const CONDITIONAL_PK_FILE = 'pk_conditional_leg.bin';

export interface ZkpArtifactSet {
	/** Static directory (under the app base path) holding the proving keys. */
	dir: string;
	/** Expected SHA-256 (lowercase hex) of each proving key. */
	bearerSha256: string;
	conditionalSha256: string;
}

interface ManifestProfile {
	dir: string;
	files: Record<string, string>;
}

const profiles = (manifest as { profiles: Record<string, ManifestProfile> }).profiles;

/** The pinned artifact set for `profile`; throws for a profile with no published keys. */
export function zkpArtifacts(profile: string): ZkpArtifactSet {
	const entry = Object.prototype.hasOwnProperty.call(profiles, profile) ? profiles[profile] : undefined;
	const bearerSha256 = entry?.files[BEARER_PK_FILE];
	const conditionalSha256 = entry?.files[CONDITIONAL_PK_FILE];
	if (!entry || !bearerSha256 || !conditionalSha256) {
		throw new Error(`no pinned proving keys for ZKP profile \`${profile}\``);
	}
	return { dir: entry.dir, bearerSha256, conditionalSha256 };
}
