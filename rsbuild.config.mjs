import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {join} from "node:path";
import {defineConfig, rspack} from "@rsbuild/core";

// The bundle carries third-party code but the minifier drops its notices, and
// MIT and BSD want the notice in every copy, so it ships beside the bundle.
const thirdPartyLicenses = {
  name: "third-party-licenses",
  setup(api) {
    api.onAfterBuild(({stats}) => {
      const roots = new Set();
      for (const {resource} of stats.compilation.modules) {
        const root = resource
          ?.replaceAll("\\", "/")
          .match(/^(.*[/]node_modules[/](?:@[^/]+[/])?[^/]+)[/]/);
        if (root) roots.add(root[1]);
      }
      const notices = [...roots]
        .map((root) => {
          const {license, name, version} = JSON.parse(
            readFileSync(join(root, "package.json"), "utf8"),
          );
          const file = readdirSync(root).find((f) =>
            /^(licen[cs]e|copying)/i.test(f),
          );
          const text = file
            ? readFileSync(join(root, file), "utf8").trim()
            : "No license file shipped.";
          return `${name}@${version} (${license})\n\n${text}`;
        })
        .sort();
      writeFileSync(
        join(api.context.distPath, "THIRD_PARTY_LICENSES.txt"),
        `${notices.join(`\n\n${"-".repeat(72)}\n\n`)}\n`,
      );
      // One LICENSE at the repo root; a clone of a mirror repo has none to copy.
      const own = new URL("../../LICENSE", import.meta.url);
      if (existsSync(own)) {
        copyFileSync(own, join(api.context.distPath, "LICENSE"));
      }
    });
  },
};

// Bundles the MCP server into a single dist/index.js that runs with no
// node_modules, the file package.json's "bin" points at.
export default defineConfig({
  output: {
    distPath: {root: "dist"},
    minify: true,
    target: "node",
  },
  plugins: [thirdPartyLicenses],
  source: {
    entry: {index: "./src/index.js"},
  },
  tools: {
    rspack: {
      module: {
        // Keep import.meta.url live: bitbucket-client.js resolves .env relative to
        // the running file, not the path it was built from.
        parser: {javascript: {importMeta: false}},
      },
      plugins: [
        new rspack.BannerPlugin({
          banner: "#!/usr/bin/env node",
          entryOnly: true,
          raw: true,
        }),
      ],
    },
  },
});
