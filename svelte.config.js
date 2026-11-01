import adapter from '@sveltejs/adapter-static';
import { resolveBuildBasePath } from './scripts/base-path.mjs';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			fallback: 'index.html'
		}),
		paths: {
			// One source per tier: wrangler.<tier>.toml WALLET_BASE_PATH; a build
			// without WALLET_TIER (or with a mismatching BASE_PATH) refuses.
			base: resolveBuildBasePath()
		}
	}
};

export default config;
