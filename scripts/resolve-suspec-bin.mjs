// Resolve the real `suspec` CLI binary for fixture generation (AC-011).
//
// The naive default (`../suspec-cli/bin/suspec.js`) assumes the sibling FOLDER is named after the
// remote — but folders and remotes deliberately differ in some checkouts (a sibling folder named
// `corpus-cli` whose package/remote is `suspec-cli`). Resolution order:
//   1. SUSPEC_BIN env var (a path to the binary), then
//   2. every sibling directory whose package.json name is "suspec-cli" and that ships bin/suspec.js
//      (folder name irrelevant), preferring `../suspec-cli` when both exist.
// Returns the absolute path, or null when nothing resolves — callers decide whether that is an error
// (the generator) or a loud skip (the drift-tripwire test).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function resolveSuspecBin(repoRoot) {
  const fromEnv = process.env.SUSPEC_BIN;
  if (fromEnv && existsSync(fromEnv)) return resolve(fromEnv);

  const parent = resolve(repoRoot, "..");
  const candidates = [];
  const preferred = join(parent, "suspec-cli");
  let entries;
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(parent, entry.name);
    const bin = join(dir, "bin", "suspec.js");
    const pkg = join(dir, "package.json");
    if (!existsSync(bin) || !existsSync(pkg)) continue;
    try {
      const name = JSON.parse(readFileSync(pkg, "utf8")).name;
      if (name === "suspec-cli") candidates.push(bin);
    } catch {
      // unreadable package.json — not a candidate
    }
  }
  const preferredBin = join(preferred, "bin", "suspec.js");
  if (candidates.includes(preferredBin)) return preferredBin;
  return candidates[0] ?? null;
}
