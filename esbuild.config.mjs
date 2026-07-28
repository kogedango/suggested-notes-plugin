import esbuild from "esbuild";
import fs from "node:fs";
import process from "process";
import builtins from "builtin-modules";
import {
  assertBundledPackages,
  bannerFrom,
  buildNotices,
} from "./scripts/licenses.mjs";

const prod = process.argv[2] === "production";

// The bundle is the only file BRAT and the community store install, so the
// notices have to travel inside it. THIRD_PARTY_NOTICES.md is written from the
// same string to keep the readable copy in the repository from drifting.
const notices = buildNotices();
fs.writeFileSync("THIRD_PARTY_NOTICES.md", notices + "\n");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  banner: { js: bannerFrom(notices) },
  metafile: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  loader: {
    ".gz": "binary",
  },
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  const result = await ctx.rebuild();
  assertBundledPackages(result.metafile);
  process.exit(0);
} else {
  await ctx.watch();
}
