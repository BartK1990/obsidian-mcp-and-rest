import esbuild from "esbuild";
import process from "process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  // 'obsidian' is provided by the app at runtime; Node builtins are available
  // because Obsidian desktop runs on Electron with Node integration enabled
  // for plugins, so we keep them external too and let Electron resolve them.
  external: ["obsidian", "electron", "node:*", "http", "crypto"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
