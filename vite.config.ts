import { existsSync } from "node:fs";
import { defineConfig, lazyPlugins } from "vite-plus";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import lintConfig from "./lint.config";

export default defineConfig({
	// Keep the existing source formatting while adopting Vite+ checks.
	check: { fmt: false },
	lint: { ...lintConfig, options: { typeAware: true, typeCheck: true } },
	resolve: {
		// css-tree's ESM build loads ../data/patch.json through createRequire, which workerd cannot resolve; the dist bundle inlines it.
		alias: [{ find: /^css-tree$/, replacement: "css-tree/dist/csstree.esm" }],
	},
	server: { allowedHosts: ["mailos.local", "mail.dev"] },
	plugins: lazyPlugins(() => [
		vinext({ images: { optimizer: imagesOptimizer() } }),
		cloudflare({
			// A private, git-ignored wrangler.prod.jsonc (your database id, custom domain, APP_URL)
			// takes precedence over the public wrangler.jsonc when it exists.
			configPath: existsSync("wrangler.prod.jsonc") ? "./wrangler.prod.jsonc" : undefined,
			// Browser tests can use disposable storage without resetting the local demo database.
			persistState: process.env.MAILOS_TEST_STATE_PATH ? { path: process.env.MAILOS_TEST_STATE_PATH } : true,
			remoteBindings: process.env.CLOUDFLARE_REMOTE_BINDINGS === "true",
			viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
		}),
	]),
});
