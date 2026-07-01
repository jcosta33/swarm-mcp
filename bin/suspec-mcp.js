#!/usr/bin/env node
// Launcher for the Suspec MCP stdio server. Dev checkout runs the TypeScript source directly via Node's
// native type stripping (no build step, Node >= 22.6); a published install runs the bundled dist. The
// server speaks the MCP protocol over stdio, so this inherits stdio and forwards signals.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceEntry = join(here, "../src/index.ts");
const builtEntry = join(here, "../dist/index.js");
const args = process.argv.slice(2);

const [major, minor] = process.versions.node.split(".").map(Number);
const nodeCanStripTypes = major > 22 || (major === 22 && minor >= 6);

let res;
// Source checkout on new-enough Node runs the TS sources; otherwise fall back to a built dist when one
// exists (so `pnpm build` IS a way out on older Node), and only error when neither path can work.
if (existsSync(sourceEntry) && !nodeCanStripTypes && !existsSync(builtEntry)) {
  console.error(
    "Error: running suspec-mcp from source needs Node.js >= 22.6. " +
      "Upgrade Node, or run `pnpm build` once — this launcher then uses the built dist/.",
  );
  console.error(`Current version: ${process.versions.node}`);
  process.exit(1);
}
if (existsSync(sourceEntry) && nodeCanStripTypes) {
  res = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      sourceEntry,
      ...args,
    ],
    { stdio: "inherit" },
  );
} else {
  res = spawnSync(process.execPath, [builtEntry, ...args], {
    stdio: "inherit",
  });
}

if (res.signal) {
  process.kill(process.pid, res.signal);
} else {
  process.exit(res.status ?? 0);
}
